/** טעינה באצוות (כמה קבצים בטרנזקציה אחת): קובץ פגום באמצע לא מפיל את האחרים */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { PriceDb } from "../src/ingest/db.ts";
import { ingestInto } from "../src/ingest/cli.ts";

const CHAIN = "7290000000001";
let dir: string;
let db: PriceDb;
beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "salbatch-")); db = await PriceDb.open(":memory:"); });
afterAll(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

function priceFile(name: string, store: string | null, items: [string, string][]) {
  const xml = `<?xml version="1.0" encoding="utf-8"?><Root><ChainId>${CHAIN}</ChainId>${store ? `<StoreId>${store}</StoreId>` : ""}<Items>` +
    items.map(([code, price]) => `<Item><ItemCode>${code}</ItemCode><ItemName>מוצר ${code}</ItemName><ItemPrice>${price}</ItemPrice></Item>`).join("") + `</Items></Root>`;
  const p = join(dir, name);
  writeFileSync(p, gzipSync(Buffer.from(xml)));
  return p;
}

test("אצווה עם קובץ פגום: הקבצים התקינים נטענים, הפגום מדווח כשגיאה ונשאר בדיסק", async () => {
  const a = priceFile(`PriceFull${CHAIN}-001-001-20260101-080000.gz`, "001", [["111", "5.00"], ["222", "7.00"]]);
  // בלי מזהה סניף, לא בשם ולא בתוכן → שגיאה
  const bad = priceFile(`PriceFull${CHAIN}-20260101-081000.gz`, null, [["111", "9.00"]]);
  const c = priceFile(`PriceFull${CHAIN}-001-002-20260101-082000.gz`, "002", [["111", "6.00"]]);
  const r = await ingestInto(db, [dir]);
  expect(r.map((x) => x.status)).toEqual(["loaded", "error", "loaded"]);
  expect(db.inBatch).toBe(false);
  const rows = await db.all<{ store_id: string; barcode: string; price_ag: number }>(`SELECT store_id, barcode, price_ag FROM current_prices ORDER BY store_id, barcode`);
  expect(rows).toEqual([{ store_id: "1", barcode: "111", price_ag: 500 }, { store_id: "1", barcode: "222", price_ag: 700 }, { store_id: "2", barcode: "111", price_ag: 600 }]);
  expect((await db.all(`SELECT 1 FROM loaded_files`)).length).toBe(2);
  expect([existsSync(a), existsSync(bad), existsSync(c)]).toEqual([false, true, false]);
});

test("אצווה תקינה: הכול בטרנזקציה אחת, היסטוריה נרשמת לפי הסדר", async () => {
  priceFile(`PriceFull${CHAIN}-001-003-20260102-080000.gz`, "003", [["111", "5.00"]]);
  priceFile(`Price${CHAIN}-001-003-20260102-120000.gz`, "003", [["111", "5.50"]]);
  priceFile(`Price${CHAIN}-001-003-20260102-160000.gz`, "003", [["111", "5.20"]]);
  rmSync(join(dir, `PriceFull${CHAIN}-20260101-081000.gz`));
  const r = await ingestInto(db, [dir]);
  expect(r.map((x) => x.status)).toEqual(["loaded", "loaded", "loaded"]);
  const h = await db.all<{ price_ag: number }>(`SELECT price_ag FROM price_history WHERE store_id = '3' ORDER BY valid_from`);
  expect(h.map((x) => x.price_ag)).toEqual([500, 550, 520]);
});
