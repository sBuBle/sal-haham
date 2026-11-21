import { expect, test } from "bun:test";
import { allPlans, bestPlan, buildMatrix, convenientPlan, planFor, priceMap, savingVs } from "../src/shared/optimize.ts";
import type { PriceRow, StoreInfo } from "../src/shared/ranking.ts";
import { formatMoney, marketById } from "../src/shared/market.ts";

const S = (id: string): StoreInfo => ({ chain_id: id, store_id: "1", chain_name: `רשת ${id}`, store_name: "סניף" });
const A = S("A"), B = S("B"), C = S("C");
const P = (s: StoreInfo, barcode: string, price_ag: number): PriceRow => ({ chain_id: s.chain_id, store_id: s.store_id, barcode, price_ag });

// תרחיש הבריף: 10 מוצרים, 3 סופרים. B חסרים 2 מוצרים. C זול בכל מוצר בודד שיש לו, אבל אין לו הכול.
const basket = Array.from({ length: 10 }, (_, i) => ({ barcode: `p${i}`, qty: 1 }));
const prices: PriceRow[] = [];
for (let i = 0; i < 10; i++) {
  prices.push(P(A, `p${i}`, 1000));
  if (i < 8) prices.push(P(B, `p${i}`, 950));
  if (i % 2 === 0) prices.push(P(C, `p${i}`, 700));
}

test("טבלת השוואה: זול, יקר, חסר וסכומים", () => {
  const m = buildMatrix(basket, [A, B, C], prices);
  expect(m.totals.map((t) => t.total_ag)).toEqual([10000, 7600, 3500]);
  expect(m.totals.map((t) => t.missing)).toEqual([0, 2, 5]);
  expect(m.totals.map((t) => t.complete)).toEqual([true, false, false]);
  const r0 = m.rows[0]!;
  expect(r0.cells.map((c) => c.cheapest)).toEqual([false, false, true]);
  expect(r0.cells.map((c) => c.priciest)).toEqual([true, false, false]);
  const r9 = m.rows[9]!; // רק ב-A
  expect(r9.cells[1]!.price_ag).toBeNull();
  expect(r9.cells[0]!.cheapest).toBe(true);
  expect(r9.cells[0]!.priciest).toBe(false);
});

test("שינוי כמות משנה את הסכומים", () => {
  const m = buildMatrix([{ barcode: "p0", qty: 3 }], [A, C], prices);
  expect(m.totals.map((t) => t.total_ag)).toEqual([3000, 2100]);
});

test("סניף אחד: רק A מכסה את כל הסל", () => {
  const p = bestPlan(basket, [A, B, C], priceMap(prices), 1)!;
  expect(p.stops.map((s) => s.store.chain_id)).toEqual(["A"]);
  expect(p.total_ag).toBe(10000);
  expect(p.found).toBe(10);
});

test("סל מפוצל ל-2 עדיף על B+C שלא מכסים הכול", () => {
  const pm = priceMap(prices);
  const p = bestPlan(basket, [A, B, C], pm, 2)!;
  expect(p.found).toBe(10);
  // C לזוגיים (5×7), A לאי-זוגיים (5×10) = 85 ₪; B+A = 8×9.5 + 2×10 = 96 ₪
  expect(p.total_ag).toBe(8500);
  expect(p.stops.map((s) => s.store.chain_id).sort()).toEqual(["A", "C"]);
});

test("פיצול ל-3 והזול בכלל", () => {
  const plans = allPlans(basket, [A, B, C], prices);
  // זוגיים ב-C (35), אי-זוגיים 1,3,5,7 ב-B (38), 9 ב-A (10) = 83 ₪
  expect(plans.split3!.total_ag).toBe(8300);
  expect(plans.unlimited!.total_ag).toBe(8300);
  expect(savingVs(plans.split2, plans.single)).toBe(1500);
});

test("נוחות: עלות עצירה גבוהה מחזירה סניף אחד", () => {
  const plans = allPlans(basket, [A, B, C], prices);
  expect(convenientPlan(plans, 0)!.stops.length).toBe(3);
  expect(convenientPlan(plans, 1000)!.stops.length).toBe(2); // 85+10 < 83+20 ו- < 100
  expect(convenientPlan(plans, 2000)!.stops.length).toBe(1); // 100 < 85+20
});

test("תוכנית לא נקראת זולה מול תוכנית עם פחות מוצרים", () => {
  const onlyC = planFor(basket, [C], priceMap(prices));
  const onlyA = planFor(basket, [A], priceMap(prices));
  expect(savingVs(onlyC, onlyA)).toBeNull();
});

test("מטבע לפי השוק", () => {
  const il = marketById("il");
  expect(formatMoney(1290, il, "en-US")).toBe("₪12.90");
  expect(formatMoney(1290, il)).toContain("12.90");
});
