/**
 * מבצעים: חישוב מחיר שורה עם מבצע. פונקציות טהורות (דפדפן ובדיקות).
 *
 * מבצע = "min_qty יחידות ב-total_ag" (min_qty=1 → מחיר מבצע ליחידה; במוצר שקיל — לק"ג).
 * כללי אמינות:
 * - מבצע נכנס לסכום רק כשהכמות בסל מספיקה לו (2 ב-24 עם יחידה אחת בסל = מחיר רגיל).
 * - יחידות מעבר לכפולה של המבצע, או מעבר למגבלה (max_qty), מחושבות במחיר הרגיל.
 * - מבצע "בקנייה מעל X" נכנס רק אם שאר הסל באותו סניף (במחיר רגיל) מגיע ל-X.
 * - מבצעי מועדון נכנסים רק אם המשתמש ביקש.
 */
import { storeKey, type BasketLine, type PriceRow } from "./ranking.ts";

export interface Deal {
  /** דורש חברות במועדון / כרטיס אשראי של הרשת */
  club: boolean;
  min_qty: number;
  /** המחיר ל-min_qty יחידות, באגורות */
  total_ag: number;
  max_qty: number | null;
  min_purchase_ag: number | null;
  /** היום האחרון, "YYYY-MM-DD" */
  ends: string;
  descr: string;
}
export interface PromoRow extends Deal { barcode: string; chain_id: string; store_id: string }

export interface AppliedDeal extends Deal {
  /** המחיר הרגיל ליחידה */
  regular_ag: number;
  /** מחיר השורה עם המבצע */
  line_ag: number;
  saved_ag: number;
}

/** מחיר ליחידה כשלוקחים את המבצע */
export const dealUnit = (d: Pick<Deal, "min_qty" | "total_ag">) => d.total_ag / Math.max(1, d.min_qty);

/** מחיר השורה (אגורות) עם המבצע, או null כשהמבצע לא חל על הכמות הזו / לא זול מהמחיר הרגיל */
export function dealLine(price_ag: number, qty: number, d: Deal): number | null {
  if (!(price_ag > 0) || !(qty > 0) || !(d.total_ag > 0)) return null;
  const cap = d.max_qty != null && d.max_qty > 0 ? Math.min(qty, d.max_qty) : qty;
  const m = Math.max(1, d.min_qty);
  const units = m <= 1 ? cap : Math.floor(cap / m) * m;
  if (!(units > 0)) return null;
  const line = Math.round(units * (d.total_ag / m) + (qty - units) * price_ag);
  return line < Math.round(price_ag * qty) ? line : null;
}

export const dealKey = (chain_id: string, store_id: string, barcode: string) => `${chain_id}|${store_id}|${barcode}`;

export const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface ApplyOptions {
  /** לכלול מבצעי מועדון */
  club?: boolean;
  /** "YYYY-MM-DD": מבצע שהסתיים לפני היום לא נכלל */
  today?: string;
}

/**
 * מחיל מבצעים על מחירי הסל. מחזיר שורות מחיר שבהן price_ag הוא המחיר האפקטיבי ליחידה לכמות שבסל
 * (line_ag / qty), כך שהדירוג, הטבלה והתוכניות מחשבים את אותו סכום בלי לדעת על מבצעים; ואת המבצע שהוחל בכל שורה.
 */
export function applyDeals(
  prices: PriceRow[],
  promos: PromoRow[],
  basket: BasketLine[],
  opts: ApplyOptions = {},
): { prices: PriceRow[]; applied: Map<string, AppliedDeal> } {
  const applied = new Map<string, AppliedDeal>();
  if (!promos.length || !prices.length) return { prices, applied };
  const qtyOf = new Map<string, number>();
  for (const b of basket) if (b.barcode && b.qty > 0) qtyOf.set(b.barcode, (qtyOf.get(b.barcode) ?? 0) + b.qty);

  const byKey = new Map<string, PromoRow[]>();
  for (const d of promos) {
    if (d.club && !opts.club) continue;
    if (opts.today && d.ends && d.ends < opts.today) continue;
    const k = dealKey(d.chain_id, d.store_id, d.barcode);
    const l = byKey.get(k);
    if (l) l.push(d); else byKey.set(k, [d]);
  }
  if (!byKey.size) return { prices, applied };

  // סכום הסל בכל סניף במחירים רגילים (לתנאי "בקנייה מעל X")
  const regular = new Map<string, number>();
  for (const p of prices) {
    const q = qtyOf.get(p.barcode);
    if (!q || !(p.price_ag > 0)) continue;
    const k = storeKey(p.chain_id, p.store_id);
    regular.set(k, (regular.get(k) ?? 0) + Math.round(p.price_ag * q));
  }

  const out = prices.map((p) => {
    const q = qtyOf.get(p.barcode);
    const deals = q ? byKey.get(dealKey(p.chain_id, p.store_id, p.barcode)) : undefined;
    if (!q || !deals) return p;
    const reg = Math.round(p.price_ag * q);
    const rest = (regular.get(storeKey(p.chain_id, p.store_id)) ?? reg) - reg;
    let best: number | null = null;
    let bestDeal: PromoRow | null = null;
    for (const d of deals) {
      if (d.min_purchase_ag != null && rest < d.min_purchase_ag) continue;
      const line = dealLine(p.price_ag, q, d);
      if (line != null && (best == null || line < best)) { best = line; bestDeal = d; }
    }
    if (best == null || !bestDeal) return p;
    const { barcode: _b, chain_id: _c, store_id: _s, ...deal } = bestDeal;
    applied.set(dealKey(p.chain_id, p.store_id, p.barcode), { ...deal, regular_ag: p.price_ag, line_ag: best, saved_ag: reg - best });
    return { ...p, price_ag: best / q };
  });
  return { prices: out, applied };
}

/** סיכום המבצעים לכל מוצר (אותה שאילתה בייצוא ובדפדפן כשמסננים לרשת אחת).
 *  deal_ag = המחיר הנמוך ליחידה במבצע לכל הלקוחות בלי תנאי קנייה; deal_qty / deal_total_ag = "deal_qty ב-deal_total_ag";
 *  club_ag = הנמוך במבצעי מועדון; n_deals = בכמה סניפים יש מבצע כלשהו. */
export const DEAL_COLS = ["deal_ag", "deal_qty", "deal_total_ag", "club_ag", "n_deals"] as const;
export const dealAggSql = (from: string, unit = "round(total_ag / min_qty)") => `
  SELECT barcode,
    min(${unit}) FILTER (WHERE NOT club AND min_purchase_ag IS NULL)::INTEGER AS deal_ag,
    arg_min(min_qty, ${unit}) FILTER (WHERE NOT club AND min_purchase_ag IS NULL)::DOUBLE AS deal_qty,
    arg_min(total_ag, ${unit}) FILTER (WHERE NOT club AND min_purchase_ag IS NULL)::INTEGER AS deal_total_ag,
    min(${unit}) FILTER (WHERE club)::INTEGER AS club_ag,
    count(DISTINCT chain_id || '|' || store_id)::INTEGER AS n_deals
  ${from} GROUP BY barcode`;

/** המבצע הטוב ביותר (מחיר ליחידה) לכל סניף+מוצר, לתצוגה בדף מוצר. open = לכל הלקוחות. */
export function bestDeals(promos: PromoRow[], today?: string): Map<string, { open: PromoRow | null; club: PromoRow | null }> {
  const m = new Map<string, { open: PromoRow | null; club: PromoRow | null }>();
  for (const d of promos) {
    if (today && d.ends && d.ends < today) continue;
    const k = dealKey(d.chain_id, d.store_id, d.barcode);
    let e = m.get(k);
    if (!e) m.set(k, (e = { open: null, club: null }));
    const slot = d.club ? "club" : "open";
    const cur = e[slot];
    if (!cur || dealUnit(d) < dealUnit(cur) || (dealUnit(d) === dealUnit(cur) && (d.min_purchase_ag ?? 0) < (cur.min_purchase_ag ?? 0))) e[slot] = d;
  }
  return m;
}
