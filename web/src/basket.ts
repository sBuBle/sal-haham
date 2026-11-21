/**
 * "סל המוצרים בפיקוח": המוצרים שמחירם המרבי נקבע בצו הפיקוח על מחירי מצרכים ושירותים (משרד הכלכלה / האוצר).
 * מקורות: protocol.co.il/price-controlled-products (טבלת המחירים המרביים), bizportal 8.10.2026 (מחירי מאי 2026).
 * כל פריט הוא הגדרה (סוג, אחוז שומן, גודל), לא מותג: בכל סניף נלקח המוצר הזול שעונה על ההגדרה.
 * חמאה הוסרה מהפיקוח ולכן לא כאן. גבינות צהובות (עמק/גלבוע) נמכרות במשקל משתנה — לא נכללו.
 */
import type { Product } from "./engine.ts";
import type { PriceRow } from "../../src/shared/ranking.ts";
import { unitPrice } from "../../src/shared/units.ts";

export interface BasketDef {
  id: string;
  label: string;
  /** המילה הראשונה בשם (חיפוש ראשוני) */
  first: string[];
  /** חייב להופיע בשם */
  must?: RegExp;
  /** פוסל */
  not?: RegExp;
  size: { kind: "g" | "l" | "u"; value: number; tol?: number };
  /** מחיר מרבי בפיקוח (₪), לתצוגה בלבד */
  max?: number;
}

const NOT_MILK = /צרפתי|ECHIRE|לקטוז|עמיד|מועשר|אורגני|שוקו|סויה|שקד|שיבולת|אורז|קוקוס|פרו|בטעם|קפה|נטול|דל|ניו|פלוס|A2|עזים|כבשים/;
export const OFFICIAL_BASKET: BasketDef[] = [
  { id: "milk3", label: "חלב טרי 3% · 1 ליטר", first: ["חלב"], must: /(^|\D)3(\.0)?\s?%/, not: NOT_MILK, size: { kind: "l", value: 1 }, max: 7.35 },
  { id: "milk1", label: "חלב טרי 1% · 1 ליטר", first: ["חלב"], must: /(^|\D)1\s?%/, not: NOT_MILK, size: { kind: "l", value: 1 }, max: 6.92 },
  { id: "white5", label: "גבינה לבנה 5% · 250 גרם", first: ["גבינה", "גבינת", "סקי"], must: /(לבנה|סקי)[^%]*5\s?%|5\s?%[^%]*(לבנה|סקי)/, not: /בטעם|זיתים|עשבי|שום|פרוס|צפתית|בולגרית|מלוח|תבלין|פטה/, size: { kind: "g", value: 250 }, max: 5.87 },
  { id: "sour15", label: "שמנת חמוצה 15% · 200 מ\"ל", first: ["שמנת"], must: /חמוצה.*15|15.*חמוצה/, not: /בטעם|לייט|עמידה/, size: { kind: "l", value: 0.2 }, max: 2.84 },
  // בצו: "שמנת מתוקה 38%", ובכלל זה שמנת להקצפה ושמנת עמידה דומות (ברשתות: "שמנת להקצפה 38%")
  { id: "sweet38", label: "שמנת מתוקה / להקצפה 38% · 250 מ\"ל", first: ["שמנת"], must: /38\s?%/, not: /חמוצה|בטעם/, size: { kind: "l", value: 0.25 }, max: 7.64 },
  { id: "eshel", label: "אשל / לבניה 4.5% · 200 מ\"ל", first: ["אשל", "אשד", "לבניה"], must: /4\.5/, not: /בטעם/, size: { kind: "l", value: 0.2 }, max: 1.99 },
  { id: "eggsL", label: "ביצים L · 12", first: ["ביצים", "ביצי"], must: /(^|[^A-Za-z])L([^A-Za-z]|$)|לארג|גדול/, not: /XL|ענק|אומגה|חופש|אורגני|מועשר|קוטג|M\b|בינוני|30|18|6\b/, size: { kind: "u", value: 12 }, max: 14.24 },
  { id: "bread", label: "לחם אחיד פרוס · 750 גרם", first: ["לחם"], must: /אחיד/, not: /מלא|שיפון|כוסמין|קל|דגנים/, size: { kind: "g", value: 750, tol: 0.08 }, max: 8.3 },
  { id: "salt", label: "מלח · 1 ק\"ג", first: ["מלח"], not: /ים|הימלאיה|אנגלי|מעושן|לימון|פלפל|שום|תיבול|ורוד|פלור|כשר לפסח|אדיגי|מלחיה/, size: { kind: "g", value: 1000 }, max: 2.07 },
];

function sizeOf(p: Product): { kind: string; v: number } {
  if (p.is_weighted) return { kind: "w", v: 1 };
  const u = unitPrice(1000, p);
  if (u) return u.per === "ליטר" ? { kind: "l", v: 1000 / u.ag } : { kind: "g", v: (1000 * 100) / u.ag };
  return { kind: "u", v: Number(p.quantity) || 1 };
}

export function matches(def: BasketDef, p: Product): boolean {
  const name = p.name ?? "";
  if (def.must && !def.must.test(name)) return false;
  if (def.not && def.not.test(name)) return false;
  const s = sizeOf(p), tol = def.size.tol ?? 0.05;
  if (def.size.kind === "u") {
    // ביצים: לפעמים הכמות לא מולאה; מסתפקים ב-12 בשם
    return (s.kind === "u" && s.v === def.size.value) || /(^|\D)12(\D|$)/.test(name);
  }
  return s.kind === def.size.kind && Math.abs(s.v - def.size.value) <= def.size.value * tol;
}

export interface BasketStore { chain_id: string; store_id: string; total_ag: number; lines: { def: BasketDef; barcode: string; name: string; price_ag: number }[] }

/** לכל סניף: המוצר הזול לכל הגדרה. סניף "מלא" = יש לו את כל ההגדרות. */
export function priceBasket(cands: Map<string, Product[]>, prices: PriceRow[]): BasketStore[] {
  const defOf = new Map<string, BasketDef>();
  const prod = new Map<string, Product>();
  for (const def of OFFICIAL_BASKET) for (const p of cands.get(def.id) ?? []) { defOf.set(p.barcode + "|" + def.id, def); prod.set(p.barcode, p); }
  const byStore = new Map<string, Map<string, { barcode: string; price_ag: number }>>();
  for (const pr of prices) {
    const sk = `${pr.chain_id}|${pr.store_id}`;
    for (const def of OFFICIAL_BASKET) {
      if (!defOf.has(pr.barcode + "|" + def.id)) continue;
      let m = byStore.get(sk); if (!m) byStore.set(sk, (m = new Map()));
      const cur = m.get(def.id);
      if (!cur || pr.price_ag < cur.price_ag) m.set(def.id, { barcode: pr.barcode, price_ag: pr.price_ag });
    }
  }
  const out: BasketStore[] = [];
  for (const [sk, m] of byStore) {
    if (m.size < OFFICIAL_BASKET.length) continue;
    const [chain_id, store_id] = sk.split("|") as [string, string];
    const lines = OFFICIAL_BASKET.map((def) => { const x = m.get(def.id)!; return { def, barcode: x.barcode, name: prod.get(x.barcode)?.name ?? "", price_ag: x.price_ag }; });
    out.push({ chain_id, store_id, total_ag: lines.reduce((s, l) => s + l.price_ag, 0), lines });
  }
  return out.sort((a, b) => a.total_ag - b.total_ag);
}
