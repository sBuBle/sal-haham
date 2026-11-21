/**
 * אילו קבצים להוריד מרשימת הקבצים של רשת. פונקציה טהורה (נבדקת ב-tests/collect-plan.test.ts).
 *
 * לכל סניף, ולכל סוג (מחירים / מבצעים):
 *   - הקובץ המלא האחרון (PriceFull / PromoFull) יורד רק אם עוד לא נטען למסד.
 *   - אם הוא כבר נטען: יורדים רק קובצי העדכון (Price / Promo) שפורסמו אחריו ועוד לא נטענו — ריצה חוזרת באותו יום
 *     מורידה כמה קבצים קטנים במקום את הכול.
 *   - עם updates: קובצי העדכון יורדים גם אחרי קובץ מלא חדש.
 */
import type { FileKind, ParsedFileName } from "../ingest/filename.ts";

export interface PlanOptions {
  /** מזהי הסניפים שנבחרו (למשל לפי עיר); null = כל הסניפים */
  storeIds?: Set<string> | null;
  maxStores?: number;
  /** קובצי עדכון גם אחרי קובץ מלא חדש */
  updates?: boolean;
  /** קובצי עדכון אחרי קובץ מלא שכבר נטען (ברירת מחדל: כן) */
  deltas?: boolean;
  promos?: boolean;
  promosOnly?: boolean;
  /** שמות קבצים שכבר נטענו למסד */
  loaded?: ReadonlySet<string>;
}

export interface DownloadPlan<T> {
  get: T[];
  /** כמה סניפים נבחרו */
  stores: number;
  /** קבצים מלאים שכבר נטענו ולכן לא יורדים */
  skipped: number;
  fulls: number;
  deltas: number;
}

type F = { name: string; meta: ParsedFileName };

const storeKey = (f: F) => f.meta.chainId + "|" + f.meta.storeId;

function latestPerStore<T extends F>(files: T[], kind: FileKind): Map<string, T> {
  const m = new Map<string, T>();
  for (const f of files) {
    if (f.meta.kind !== kind || !f.meta.storeId) continue;
    const cur = m.get(storeKey(f));
    if (!cur || f.meta.timestamp > cur.meta.timestamp) m.set(storeKey(f), f);
  }
  return m;
}

export function planDownloads<T extends F>(files: T[], opts: PlanOptions = {}): DownloadPlan<T> {
  const loaded = opts.loaded ?? new Set<string>();
  const priceFull = latestPerStore(files, "PriceFull");
  // הסניפים נקבעים לפי קובצי המחירים המלאים (גם כשמורידים רק מבצעים)
  let selected = [...priceFull.values()];
  if (opts.storeIds) selected = selected.filter((f) => opts.storeIds!.has(f.meta.storeId!));
  selected.sort((a, b) => Number(a.meta.storeId) - Number(b.meta.storeId));
  if (opts.maxStores) selected = selected.slice(0, opts.maxStores);
  const want = new Set(selected.map(storeKey));

  const plan: DownloadPlan<T> = { get: [], stores: selected.length, skipped: 0, fulls: 0, deltas: 0 };
  const add = (fullKind: FileKind, deltaKind: FileKind) => {
    const fulls = fullKind === "PriceFull" ? priceFull : latestPerStore(files, fullKind);
    const deltasBy = new Map<string, T[]>();
    for (const f of files) {
      if (f.meta.kind !== deltaKind || !f.meta.storeId || !want.has(storeKey(f))) continue;
      const l = deltasBy.get(storeKey(f));
      if (l) l.push(f); else deltasBy.set(storeKey(f), [f]);
    }
    for (const [key, full] of fulls) {
      if (!want.has(key)) continue;
      const have = loaded.has(full.name);
      if (have) plan.skipped++;
      else { plan.get.push(full); plan.fulls++; }
      if (have ? opts.deltas !== false : opts.updates) {
        for (const d of deltasBy.get(key) ?? []) {
          if (d.meta.timestamp > full.meta.timestamp && !loaded.has(d.name)) { plan.get.push(d); plan.deltas++; }
        }
      }
    }
  };
  if (!opts.promosOnly) add("PriceFull", "Price");
  if (opts.promos !== false) add("PromoFull", "Promo");
  return plan;
}
