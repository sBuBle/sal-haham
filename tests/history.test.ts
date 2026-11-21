import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { PriceDb } from "../src/ingest/db.ts";

const CHAIN = "7290000000001";
let dir: string;
let db: PriceDb;

function priceFile(name: string, items: [string, string][], update = "2026-01-01 08:00:00") {
  const xml = `<?xml version="1.0" encoding="utf-8"?><Root><ChainId>${CHAIN}</ChainId><StoreId>001</StoreId><Items>` +
    items.map(([code, price]) => `<Item><ItemCode>${code}</ItemCode><ItemName>מוצר ${code}</ItemName><ItemPrice>${price}</ItemPrice><PriceUpdateDate>${update}</PriceUpdateDate></Item>`).join("") +
    `</Items></Root>`;
  const p = join(dir, name);
  writeFileSync(p, gzipSync(Buffer.from(xml)));
  return p;
}

const history = (code: string) =>
  db.all<{ price_ag: number }>(`SELECT price_ag FROM price_history WHERE barcode = $b ORDER BY valid_from`, { b: code });
const current = (code: string) =>
  db.all<{ price_ag: number; last_seen: string }>(`SELECT price_ag, strftime(last_seen, '%Y-%m-%d %H:%M') AS last_seen FROM current_prices WHERE barcode = $b`, { b: code });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "salhist-"));
  db = await PriceDb.open(":memory:");
});
afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("היסטוריית מחירים", () => {
  test("טעינה ראשונה: שורת היסטוריה לכל מוצר", async () => {
    const r = await db.ingestFile(priceFile(`PriceFull${CHAIN}-001-001-20260101-080000.gz`, [["111", "5.00"], ["222", "10.00"]]));
    expect(r).toMatchObject({ status: "loaded", rows: 2, newHistory: 2 });
    expect(await history("111")).toEqual([{ price_ag: 500 }]);
  });

  test("מחיר שלא השתנה לא מוסיף שורה; מחיר שהשתנה מוסיף", async () => {
    const r = await db.ingestFile(priceFile(`PriceFull${CHAIN}-001-001-20260102-080000.gz`, [["111", "5.00"], ["222", "11.50"]], "2026-01-02 07:00:00"));
    expect(r.newHistory).toBe(1);
    expect(await history("111")).toEqual([{ price_ag: 500 }]);
    expect(await history("222")).toEqual([{ price_ag: 1000 }, { price_ag: 1150 }]);
    expect(await current("111")).toEqual([{ price_ag: 500, last_seen: "2026-01-02 08:00" }]); // last_seen מתעדכן
  });

  test("קובץ זהה (sha256) מדולג", async () => {
    const p = priceFile(`PriceFull${CHAIN}-001-001-20260102-080000.gz`, [["111", "5.00"], ["222", "11.50"]], "2026-01-02 07:00:00");
    expect((await db.ingestFile(p)).status).toBe("skipped-duplicate");
  });

  test("קובץ ישן שמגיע מאוחר לא דורס מחיר חדש ולא נכנס להיסטוריה", async () => {
    const r = await db.ingestFile(priceFile(`Price${CHAIN}-001-001-20251231-080000.gz`, [["222", "9.00"]], "2025-12-31 07:00:00"));
    expect(r.status).toBe("loaded");
    expect(r.newHistory).toBe(0);
    expect((await current("222"))[0]!.price_ag).toBe(1150);
  });

  test("חזרה למחיר קודם נרשמת כשינוי", async () => {
    await db.ingestFile(priceFile(`Price${CHAIN}-001-001-20260103-080000.gz`, [["222", "10.00"]], "2026-01-03 07:00:00"));
    expect(await history("222")).toEqual([{ price_ag: 1000 }, { price_ag: 1150 }, { price_ag: 1000 }]);
  });

  test("מוצר נשמר פעם אחת בטבלת products", async () => {
    const r = await db.all<{ n: number }>(`SELECT count(*)::INT AS n FROM products`);
    expect(r[0]!.n).toBe(2);
  });

  test("טבלאות ה-staging הן TEMP ולא נשארות במסד", async () => {
    const r = await db.all<{ n: number }>(`SELECT count(*)::INT AS n FROM duckdb_tables() WHERE NOT temporary AND table_name LIKE 'stg%'`);
    expect(r[0]!.n).toBe(0);
  });
});
