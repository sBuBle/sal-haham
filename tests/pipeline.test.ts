/** קצה-לקצה על נתוני הבדיקה הסינתטיים: gen → ingest → export → קריאת ה-Parquet */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { writeSynthetic, TEST_CHAINS, TEST_STORES, priceAg } from "../scripts/gen-synthetic.ts";
import { ingestPaths } from "../src/ingest/cli.ts";
import { exportSite, type SiteIndex } from "../src/ingest/export.ts";
import { rankStores } from "../src/shared/ranking.ts";

let dir: string;
let index: SiteIndex;
let results: Awaited<ReturnType<typeof ingestPaths>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "salpipe-"));
  writeSynthetic(join(dir, "raw"), { updates: true });
  results = await ingestPaths([join(dir, "raw")], { db: join(dir, "db.duckdb") });
  index = await exportSite(join(dir, "db.duckdb"), join(dir, "site"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const q = async (sql: string) => {
  const inst = await DuckDBInstance.create(":memory:");
  const con = await inst.connect();
  const r = (await con.runAndReadAll(sql)).getRowObjectsJson();
  con.closeSync();
  inst.closeSync();
  return r as any[];
};
const pq = (rel: string) => join(dir, "site", rel).replace(/\\/g, "/");

describe("pipeline", () => {
  test("כל הקבצים נטענו, והגולמיים נמחקו", () => {
    expect(results.filter((r) => r.status !== "loaded")).toEqual([]);
    expect(results.map((r) => `${r.compression}/${r.encoding}`)).toContain("zip/windows-1255");
    expect(results.map((r) => `${r.compression}/${r.encoding}`)).toContain("none/utf16le");
    expect(readdirSync(join(dir, "raw"))).toEqual([]);
  });

  test("ערים מנורמלות: קוד 3000, 'תל אביב-יפו', 'קריית אונו'/'קרית-אונו'", () => {
    const by = Object.fromEntries(index.cities.map((c) => [c.key, c.stores]));
    expect(by).toEqual({ "ירושלים": 4, "תל אביב": 3, "קרית אונו": 2 });
  });

  test("דגל נתוני בדיקה + שמות רשתות מסומנים", () => {
    expect(index.testData).toBe(true);
    expect(index.chains.every((c) => c.name.includes("נתוני בדיקה"))).toBe(true);
  });

  test("Parquet ממוין לפי barcode, chain_id, store_id", async () => {
    const rows = await q(`SELECT barcode, chain_id, store_id FROM '${pq("all/prices.parquet")}'`);
    const keys = rows.map((r) => `${r.barcode}\u0000${r.chain_id}\u0000${r.store_id}`);
    expect(keys).toEqual([...keys].sort());
  });

  test("Parquet דחוס ב-zstd", async () => {
    const r = await q(`SELECT DISTINCT compression FROM parquet_metadata('${pq("all/prices.parquet")}')`);
    expect(r.map((x) => x.compression)).toEqual(["ZSTD"]);
  });

  test("קוד פנימי (ItemType=0) מאוחד בייצוא לפי שם+כמות+יחידה (מזהה n:)", async () => {
    const r = await q(`SELECT barcode, is_weighted FROM '${pq("all/products.parquet")}' WHERE barcode LIKE '%:%'`);
    expect(r.length).toBe(1);
    expect(r[0]!.barcode).toMatch(/^n:[0-9a-f]{12}$/);
    expect(r[0]!.is_weighted).toBe(true);
  });

  test("רווחים מיותרים נוקו, ברקוד עם 00 מוביל מנורמל", async () => {
    const r = await q(`SELECT name, manufacturer FROM '${pq("all/products.parquet")}' WHERE barcode = '99900000309'`);
    expect(r).toEqual([{ name: "חטיף תירס", manufacturer: "ממתקי דמו" }]);
  });

  test("עדכון Price חלקי נכנס (מחיר חדש למוצר 0 בסניף A-001)", async () => {
    const r = await q(`SELECT price_ag FROM '${pq("all/prices.parquet")}' WHERE barcode = '9990000000101' AND chain_id = '${TEST_CHAINS.A.id}' AND store_id = '1'`);
    expect(r).toEqual([{ price_ag: priceAg(TEST_STORES[0]!, 0, 50) }]);
  });

  test("דירוג סל מנתוני העיר: ירושלים, 5 מוצרים", async () => {
    const slug = index.cities.find((c) => c.key === "ירושלים")!.slug;
    const stores = JSON.parse(readFileSync(join(dir, "site", "cities", slug, "stores.json"), "utf8"));
    const basket = ["9990000000101", "9990000000118", "9990000000125", "9990000000149", "9990000000156"].map((barcode) => ({ barcode, qty: 1 }));
    const prices = await q(`SELECT barcode, chain_id, store_id, price_ag FROM '${pq(`cities/${slug}/prices.parquet`)}' WHERE barcode IN (${basket.map((b) => `'${b.barcode}'`).join(",")})`);
    const r = rankStores(basket, stores, prices);
    expect(r.length).toBe(4);
    // סניף C-21 בלי חלב → אחרון וחלקי; השאר מלאים וממוינים לפי מחיר
    expect(r.at(-1)!.store.store_id).toBe("21");
    expect(r.at(-1)!.missing.map((m) => m.barcode)).toEqual(["9990000000101"]);
    const full = r.filter((x) => x.complete).map((x) => x.total_ag);
    expect(full).toEqual([...full].sort((x, y) => x - y));
    expect(r[0]!.store.chain_id).toBe(TEST_CHAINS.A.id); // הרשת הזולה בנתוני הבדיקה
  });

  test("ייצוא לעיר כולל רק את סניפי העיר", () => {
    for (const c of index.cities) {
      const s = JSON.parse(readFileSync(join(dir, "site", "cities", c.slug, "stores.json"), "utf8"));
      expect(s.length).toBe(c.stores);
      expect(existsSync(join(dir, "site", "cities", c.slug, "products.parquet"))).toBe(true);
    }
  });
});
