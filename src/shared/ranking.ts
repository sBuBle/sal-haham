/**
 * דירוג סניפים לפי סל. פונקציה טהורה, משמשת בדפדפן (על תוצאות DuckDB-WASM) ובבדיקות.
 *
 * כללי הדירוג:
 * 1. קודם סניפים שיש בהם את כל הסל, לפי המחיר הכולל (זול → יקר).
 * 2. אחריהם סניפים חלקיים: יותר מוצרים קודם, ובין שווים, לפי המחיר הכולל.
 * חיסכון: לכל סניף משווים לסניף היקר ביותר שיש בו לפחות את אותם מוצרים,
 * כך שההשוואה תמיד על אותו סל בדיוק (לא "חוסכים" על מוצר שחסר).
 */

export interface BasketLine {
  barcode: string;
  qty: number;
  name?: string;
}

export interface StoreInfo {
  chain_id: string;
  store_id: string;
  chain_name: string;
  store_name: string;
  address?: string;
  city?: string;
  stale?: boolean;
}

export interface PriceRow {
  barcode: string;
  chain_id: string;
  store_id: string;
  price_ag: number;
}

export interface ResultLine {
  barcode: string;
  qty: number;
  price_ag: number;
  line_ag: number;
}

export interface StoreResult {
  store: StoreInfo;
  total_ag: number;
  found: number;
  total_items: number;
  /** 0..1 */
  coverage: number;
  complete: boolean;
  lines: ResultLine[];
  missing: BasketLine[];
  /** חיסכון באגורות לעומת הסניף היקר ביותר שיש בו את אותם מוצרים (0 אם זה הסניף היקר) */
  savings_ag: number;
  savings_ref: StoreInfo | null;
}

export interface RankOptions {
  /** לכלול סניפים שאין בהם אף מוצר מהסל (ברירת מחדל: לא) */
  includeEmpty?: boolean;
  /** כמה תוצאות לחשב עבורן חיסכון (החישוב ריבועי במספר הסניפים) */
  savingsLimit?: number;
}

export const storeKey = (chain_id: string, store_id: string) => `${chain_id}|${store_id}`;

/** מאחד שורות כפולות של אותו ברקוד ומסנן כמויות לא חוקיות */
export function normalizeBasket(basket: BasketLine[]): BasketLine[] {
  const m = new Map<string, BasketLine>();
  for (const b of basket) {
    if (!b.barcode || !(b.qty > 0)) continue;
    const cur = m.get(b.barcode);
    if (cur) cur.qty += b.qty;
    else m.set(b.barcode, { ...b });
  }
  return [...m.values()];
}

export function rankStores(
  basketIn: BasketLine[],
  stores: StoreInfo[],
  prices: PriceRow[],
  opts: RankOptions = {},
): StoreResult[] {
  const basket = normalizeBasket(basketIn);
  const qtyOf = new Map(basket.map((b) => [b.barcode, b.qty]));
  const n = basket.length;

  // מחירים לפי סניף → ברקוד
  const byStore = new Map<string, Map<string, number>>();
  for (const p of prices) {
    if (!qtyOf.has(p.barcode) || !(p.price_ag > 0)) continue;
    const k = storeKey(p.chain_id, p.store_id);
    let m = byStore.get(k);
    if (!m) byStore.set(k, (m = new Map()));
    const prev = m.get(p.barcode);
    if (prev === undefined || p.price_ag < prev) m.set(p.barcode, p.price_ag);
  }

  const results: StoreResult[] = [];
  for (const store of stores) {
    const m = byStore.get(storeKey(store.chain_id, store.store_id));
    if ((!m || m.size === 0) && !opts.includeEmpty) continue;
    const lines: ResultLine[] = [];
    const missing: BasketLine[] = [];
    let total = 0;
    for (const b of basket) {
      const price = m?.get(b.barcode);
      if (price === undefined) {
        missing.push(b);
      } else {
        const line_ag = Math.round(price * b.qty);
        total += line_ag;
        lines.push({ barcode: b.barcode, qty: b.qty, price_ag: price, line_ag });
      }
    }
    results.push({
      store,
      total_ag: total,
      found: lines.length,
      total_items: n,
      coverage: n === 0 ? 0 : lines.length / n,
      complete: n > 0 && missing.length === 0,
      lines,
      missing,
      savings_ag: 0,
      savings_ref: null,
    });
  }

  results.sort(compareResults);

  // חיסכון
  const limit = opts.savingsLimit ?? 200;
  const complete = results.filter((r) => r.complete);
  const priciestComplete = complete.length ? complete[complete.length - 1]! : null;
  for (let i = 0; i < results.length && i < limit; i++) {
    const r = results[i]!;
    if (r.found === 0) continue;
    if (r.complete && priciestComplete) {
      r.savings_ag = priciestComplete.total_ag - r.total_ag;
      r.savings_ref = r.savings_ag > 0 ? priciestComplete.store : null;
      continue;
    }
    let bestRef: StoreResult | null = null;
    let bestSum = -1;
    for (const t of results) {
      if (t === r) continue;
      const tm = byStore.get(storeKey(t.store.chain_id, t.store.store_id));
      if (!tm) continue;
      let sum = 0;
      let ok = true;
      for (const l of r.lines) {
        const p = tm.get(l.barcode);
        if (p === undefined) { ok = false; break; }
        sum += Math.round(p * l.qty);
      }
      if (ok && sum > bestSum) { bestSum = sum; bestRef = t; }
    }
    if (bestRef && bestSum > r.total_ag) {
      r.savings_ag = bestSum - r.total_ag;
      r.savings_ref = bestRef.store;
    }
  }
  return results;
}

function compareResults(a: StoreResult, b: StoreResult): number {
  if (a.complete !== b.complete) return a.complete ? -1 : 1;
  if (!a.complete && a.found !== b.found) return b.found - a.found;
  if (a.total_ag !== b.total_ag) return a.total_ag - b.total_ag;
  const an = a.store.chain_name + a.store.store_name;
  const bn = b.store.chain_name + b.store.store_name;
  return an < bn ? -1 : an > bn ? 1 : 0;
}
