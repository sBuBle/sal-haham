/**
 * טבלת השוואה ותוכניות קנייה לסל. פונקציות טהורות (דפדפן ובדיקות).
 *
 * כללי אמינות:
 * - מחיר = מחיר אמיתי של אותו ברקוד באותו סניף. אין הערכות ואין "חלופות" כאן.
 * - תוכנית נחשבת "זולה יותר" רק מול תוכנית שמכסה אותו מספר מוצרים.
 * - דמי משלוח והזמנת מינימום לא ידועים (אין נתונים) ולכן לא נכללים, וכל תוכנית מסומנת deliveryKnown=false.
 */
import { normalizeBasket, storeKey, type BasketLine, type PriceRow, type StoreInfo } from "./ranking.ts";

export type PriceMap = Map<string, Map<string, number>>; // storeKey → barcode → price

export function priceMap(prices: PriceRow[]): PriceMap {
  const m: PriceMap = new Map();
  for (const p of prices) {
    if (!(p.price_ag > 0)) continue;
    const k = storeKey(p.chain_id, p.store_id);
    let s = m.get(k);
    if (!s) m.set(k, (s = new Map()));
    const prev = s.get(p.barcode);
    if (prev === undefined || p.price_ag < prev) s.set(p.barcode, p.price_ag);
  }
  return m;
}

// ---------------------------------------------------------------- comparison table
export interface Cell {
  price_ag: number | null;
  line_ag: number | null;
  /** הזול ביותר בשורה (יכולים להיות כמה בתיקו) */
  cheapest: boolean;
  /** היקר ביותר בשורה, כשיש לפחות 2 מחירים שונים */
  priciest: boolean;
}
export interface MatrixRow { barcode: string; qty: number; cells: Cell[]; min_ag: number | null }
export interface MatrixTotal { total_ag: number; found: number; missing: number; complete: boolean }
export interface Matrix { stores: StoreInfo[]; rows: MatrixRow[]; totals: MatrixTotal[] }

export function buildMatrix(basketIn: BasketLine[], stores: StoreInfo[], prices: PriceRow[] | PriceMap): Matrix {
  const basket = normalizeBasket(basketIn);
  const pm = prices instanceof Map ? prices : priceMap(prices);
  const maps = stores.map((s) => pm.get(storeKey(s.chain_id, s.store_id)));
  const totals: MatrixTotal[] = stores.map(() => ({ total_ag: 0, found: 0, missing: 0, complete: false }));
  const rows: MatrixRow[] = basket.map((b) => {
    const ps = maps.map((m) => m?.get(b.barcode) ?? null);
    const have = ps.filter((p): p is number => p !== null);
    const min = have.length ? Math.min(...have) : null;
    const max = have.length ? Math.max(...have) : null;
    const cells = ps.map((p, i) => {
      if (p === null) { totals[i]!.missing++; return { price_ag: null, line_ag: null, cheapest: false, priciest: false }; }
      const line = Math.round(p * b.qty);
      totals[i]!.total_ag += line;
      totals[i]!.found++;
      return { price_ag: p, line_ag: line, cheapest: p === min, priciest: max !== min && p === max };
    });
    return { barcode: b.barcode, qty: b.qty, cells, min_ag: min };
  });
  for (const t of totals) t.complete = basket.length > 0 && t.missing === 0;
  return { stores, rows, totals };
}

// ---------------------------------------------------------------- plans
export interface PlanStop { store: StoreInfo; lines: { barcode: string; qty: number; price_ag: number; line_ag: number }[]; subtotal_ag: number }
export interface Plan {
  kind: "single" | "split" | "convenience";
  stops: PlanStop[];
  total_ag: number;
  found: number;
  total_items: number;
  missing: BasketLine[];
  /** דמי משלוח והזמנת מינימום לא ידועים לנו */
  deliveryKnown: false;
}

/** מחלק כל מוצר לסניף הזול ביותר מתוך הקבוצה שיש בו אותו */
export function planFor(basketIn: BasketLine[], set: StoreInfo[], pm: PriceMap, kind: Plan["kind"] = "split"): Plan {
  const basket = normalizeBasket(basketIn);
  const stops = new Map<string, PlanStop>();
  const missing: BasketLine[] = [];
  let total = 0;
  for (const b of basket) {
    let best: StoreInfo | null = null;
    let bp = Infinity;
    for (const s of set) {
      const p = pm.get(storeKey(s.chain_id, s.store_id))?.get(b.barcode);
      if (p !== undefined && p < bp) { bp = p; best = s; }
    }
    if (!best) { missing.push(b); continue; }
    const k = storeKey(best.chain_id, best.store_id);
    let stop = stops.get(k);
    if (!stop) stops.set(k, (stop = { store: best, lines: [], subtotal_ag: 0 }));
    const line = Math.round(bp * b.qty);
    stop.lines.push({ barcode: b.barcode, qty: b.qty, price_ag: bp, line_ag: line });
    stop.subtotal_ag += line;
    total += line;
  }
  const list = [...stops.values()].sort((a, b) => b.subtotal_ag - a.subtotal_ag);
  return { kind, stops: list, total_ag: total, found: basket.length - missing.length, total_items: basket.length, missing, deliveryKnown: false };
}

const better = (a: Plan, b: Plan | null) => !b || a.found > b.found || (a.found === b.found && (a.total_ag < b.total_ag || (a.total_ag === b.total_ag && a.stops.length < b.stops.length)));

/**
 * הצירוף הטוב ביותר של עד k סניפים: קודם כמה שיותר מוצרים, אחר כך המחיר הנמוך.
 * חיפוש מלא על כל הצירופים (k ≤ 3). עם הרבה סניפים מצמצמים קודם ל-maxCandidates הסניפים עם הכי הרבה מוצרים.
 */
export function bestPlan(basketIn: BasketLine[], stores: StoreInfo[], pm: PriceMap, k: number, maxCandidates = 60): Plan | null {
  const basket = normalizeBasket(basketIn);
  if (!basket.length) return null;
  const cover = (s: StoreInfo) => {
    const m = pm.get(storeKey(s.chain_id, s.store_id));
    return m ? basket.reduce((n, b) => n + (m.has(b.barcode) ? 1 : 0), 0) : 0;
  };
  const cands = stores.map((s) => ({ s, c: cover(s) })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c).slice(0, maxCandidates).map((x) => x.s);
  let best: Plan | null = null;
  const n = cands.length;
  const kind: Plan["kind"] = k === 1 ? "single" : "split";
  for (let i = 0; i < n; i++) {
    if (k === 1) { const p = planFor(basket, [cands[i]!], pm, kind); if (better(p, best)) best = p; continue; }
    for (let j = i + 1; j < n; j++) {
      if (k === 2) { const p = planFor(basket, [cands[i]!, cands[j]!], pm, kind); if (better(p, best)) best = p; continue; }
      for (let l = j + 1; l < n; l++) {
        const p = planFor(basket, [cands[i]!, cands[j]!, cands[l]!], pm, kind);
        if (better(p, best)) best = p;
      }
    }
  }
  // צירוף של 2-3 סניפים שבפועל משתמש בפחות סניפים = תוכנית של פחות סניפים
  if (best && best.stops.length === 1) best = { ...best, kind: "single" };
  return best;
}

export interface Plans {
  single: Plan | null;
  split2: Plan | null;
  split3: Plan | null;
  /** הזול ביותר בכלל: כל מוצר בסניף הזול ביותר שלו בעיר (יכול לדרוש הרבה עצירות) */
  unlimited: Plan | null;
}

export function allPlans(basket: BasketLine[], stores: StoreInfo[], prices: PriceRow[] | PriceMap): Plans {
  const pm = prices instanceof Map ? prices : priceMap(prices);
  const unlimited = basket.length ? planFor(basket, stores, pm, "split") : null;
  return {
    single: bestPlan(basket, stores, pm, 1),
    split2: bestPlan(basket, stores, pm, 2),
    split3: bestPlan(basket, stores, pm, 3),
    unlimited,
  };
}

/**
 * תוכנית "נוחות": ממזערת מחיר + עלות לכל עצירה נוספת (stopCost, שהמשתמש קובע: זמן, נסיעה, משלוח נוסף).
 * בוחרת רק בין תוכניות עם הכיסוי המקסימלי.
 */
export function convenientPlan(plans: Plans, stopCost_ag: number): Plan | null {
  const list = [plans.single, plans.split2, plans.split3].filter((p): p is Plan => !!p);
  if (!list.length) return null;
  const maxFound = Math.max(...list.map((p) => p.found));
  const score = (p: Plan) => p.total_ag + stopCost_ag * (p.stops.length - 1);
  const best = list.filter((p) => p.found === maxFound).sort((a, b) => score(a) - score(b) || a.stops.length - b.stops.length)[0]!;
  return { ...best, kind: "convenience" };
}

/** חיסכון של תוכנית מול אחרת, רק כשהן מכסות אותו מספר מוצרים */
export function savingVs(a: Plan | null, b: Plan | null): number | null {
  if (!a || !b || a.found !== b.found) return null;
  return b.total_ag - a.total_ag;
}
