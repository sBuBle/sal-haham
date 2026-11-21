import { describe, expect, test } from "bun:test";
import { rankStores, type PriceRow, type StoreInfo } from "../src/shared/ranking.ts";

const S = (chain: string, id: string): StoreInfo => ({ chain_id: chain, store_id: id, chain_name: `רשת ${chain}`, store_name: `סניף ${id}` });
const P = (store: StoreInfo, barcode: string, price_ag: number): PriceRow => ({ chain_id: store.chain_id, store_id: store.store_id, barcode, price_ag });

const a = S("A", "1"), b = S("B", "2"), c = S("C", "3"), d = S("D", "4"), e = S("E", "5");
const stores = [a, b, c, d, e];
const basket = [
  { barcode: "milk", qty: 2 },
  { barcode: "bread", qty: 1 },
  { barcode: "eggs", qty: 1 },
];
const prices: PriceRow[] = [
  // A: הסל המלא, 2*600+800+1300 = 3300
  P(a, "milk", 600), P(a, "bread", 800), P(a, "eggs", 1300),
  // B: הסל המלא, יקר יותר: 2*700+900+1400 = 3700
  P(b, "milk", 700), P(b, "bread", 900), P(b, "eggs", 1400),
  // C: חסר ביצים, זול מאוד (2*500+700 = 1700) — לא צריך לעקוף סניפים מלאים
  P(c, "milk", 500), P(c, "bread", 700),
  // D: רק לחם
  P(d, "bread", 650),
  // E: אין כלום מהסל (מוצר אחר)
  P(e, "other", 100),
];

describe("rankStores", () => {
  const r = rankStores(basket, stores, prices);

  test("קודם סניפים עם כל הסל לפי מחיר, אחר כך חלקיים לפי כיסוי", () => {
    expect(r.map((x) => x.store.chain_id)).toEqual(["A", "B", "C", "D"]);
    expect(r.map((x) => x.complete)).toEqual([true, true, false, false]);
  });

  test("סכום כולל עם כמויות", () => {
    expect(r[0]!.total_ag).toBe(3300);
    expect(r[1]!.total_ag).toBe(3700);
    expect(r[2]!.total_ag).toBe(1700);
  });

  test("אחוז כיסוי ורשימת חסרים", () => {
    expect(r[2]!.coverage).toBeCloseTo(2 / 3);
    expect(r[2]!.missing.map((m) => m.barcode)).toEqual(["eggs"]);
    expect(r[3]!.found).toBe(1);
  });

  test("חיסכון לעומת הסניף המלא היקר ביותר", () => {
    expect(r[0]!.savings_ag).toBe(400);
    expect(r[0]!.savings_ref?.chain_id).toBe("B");
    expect(r[1]!.savings_ag).toBe(0); // זה הסניף היקר
  });

  test("חיסכון לסניף חלקי מחושב על אותם מוצרים בלבד", () => {
    // C (חלב+לחם=1700) מול היקר ביותר שיש בו חלב+לחם: B = 2*700+900 = 2300
    expect(r[2]!.savings_ag).toBe(600);
    expect(r[2]!.savings_ref?.chain_id).toBe("B");
  });

  test("סניף בלי אף מוצר מהסל לא מוצג (אלא אם ביקשו)", () => {
    expect(r.find((x) => x.store.chain_id === "E")).toBeUndefined();
    expect(rankStores(basket, stores, prices, { includeEmpty: true }).at(-1)!.store.chain_id).toBe("E");
  });

  test("שורות כפולות בסל מתאחדות", () => {
    const r2 = rankStores([{ barcode: "milk", qty: 1 }, { barcode: "milk", qty: 1 }], [a], prices);
    expect(r2[0]!.total_ag).toBe(1200);
    expect(r2[0]!.total_items).toBe(1);
  });

  test("כמות שקילה (ק\"ג חלקי) מעוגלת לאגורה", () => {
    const r3 = rankStores([{ barcode: "milk", qty: 0.333 }], [a], prices);
    expect(r3[0]!.total_ag).toBe(200);
  });

  test("שוויון במחיר: סדר יציב לפי שם", () => {
    const x = S("X", "9"), y = S("Y", "8");
    const r4 = rankStores([{ barcode: "m", qty: 1 }], [y, x], [P(y, "m", 100), P(x, "m", 100)]);
    expect(r4.map((s) => s.store.chain_id)).toEqual(["X", "Y"]);
  });

  test("סל ריק → אין תוצאות", () => {
    expect(rankStores([], stores, prices)).toEqual([]);
  });
});
