/**
 * bun run collect --chains ramilevi,osherad [--city ירושלים] [--max-stores 20] [--updates] [--out tmp/raw] [--db data/prices.duckdb]
 *
 * מוריד לכל רשת: קובץ Stores האחרון, PriceFull האחרון ו-PromoFull (מבצעים) האחרון לכל סניף.
 * קובץ שכבר נטען למסד (--db) לא יורד שוב; אם הקובץ המלא של סניף כבר נטען, יורדים רק קובצי העדכון
 * (Price / Promo) שפורסמו אחריו. עם --city מורידים רק לסניפים באותה עיר (לפי קובץ ה-Stores).
 * --updates: קובצי עדכון גם אחרי קובץ מלא חדש. --no-deltas: בלי קובצי עדכון בכלל.
 * --no-promos: בלי קובצי מבצעים. --promos-only: רק מבצעים (לסניפים שיש להם PriceFull ברשימה).
 * --all: להוריד גם קבצים שכבר נטענו. --parallel N: כמה רשתות במקביל (ברירת מחדל 4).
 * הקבצים נשמרים זמנית ב---out; ה-ingest מוחק אותם אחרי הטעינה.
 */
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CHAINS, chainById, type ChainSource } from "./chains.ts";
import { parseFileName, type ParsedFileName } from "../ingest/filename.ts";
import { pool } from "./http.ts";
import type { RemoteFile } from "./engines.ts";
import { planDownloads } from "./plan.ts";
import { loadedFileNames } from "./loaded.ts";
import { openText } from "../ingest/decode.ts";
import { parseRecords } from "../ingest/parser.ts";
import { toStore } from "../ingest/records.ts";
import { loadCityCodes } from "../ingest/cities.ts";
import { normalizeCity } from "../shared/city.ts";

export interface CollectOptions {
  out: string;
  city?: string;
  maxStores?: number;
  /** קובצי עדכון (Price / Promo) גם אחרי קובץ מלא חדש */
  updates?: boolean;
  /** קובצי עדכון אחרי קובץ מלא שכבר נטען (ברירת מחדל: כן) */
  deltas?: boolean;
  /** להוריד גם קובצי מבצעים (ברירת מחדל: כן) */
  promos?: boolean;
  /** רק קובצי מבצעים, בלי מחירים */
  promosOnly?: boolean;
  /** שמות קבצים שכבר נטענו למסד — לא יורדים שוב */
  loaded?: ReadonlySet<string>;
  concurrency?: number;
  log?: (s: string) => void;
}

export interface CollectStats { files: number; skipped: number; fulls: number; deltas: number; failed: number }

type Listed = RemoteFile & { meta: ParsedFileName };

function latestBy<T>(items: T[], key: (t: T) => string, ts: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) {
    const k = key(it);
    const cur = m.get(k);
    if (!cur || ts(it) > ts(cur)) m.set(k, it);
  }
  return m;
}

async function storesInCity(path: string, chainId: string, cityKey: string): Promise<Set<string>> {
  const codes = loadCityCodes();
  const ids = new Set<string>();
  const { chunks } = await openText(path);
  await parseRecords(chunks, (kind, rec, ctx) => {
    if (kind !== "store") return;
    const s = toStore(rec, ctx, chainId, codes);
    if (s && s.city_key === cityKey) ids.add(s.store_id);
  }, undefined, ["store"]);
  return ids;
}

export async function collectChain(src: ChainSource, opts: CollectOptions, stats?: CollectStats): Promise<string[]> {
  const log = opts.log ?? console.log;
  if (!src.make) {
    log(`- ${src.name}: לא נתמך ישירות (${src.note})`);
    return [];
  }
  const loaded = opts.loaded ?? new Set<string>();
  const t0 = performance.now();
  const listing = await src.make().list();
  const files: Listed[] = listing
    .map((f) => ({ ...f, meta: parseFileName(f.name)! }))
    .filter((f) => f.meta);
  log(`- ${src.name}: ${listing.length} קבצים ברשימה (${((performance.now() - t0) / 1000).toFixed(1)}s)`);

  const dir = join(opts.out, src.id);
  mkdirSync(dir, { recursive: true });
  const fetchOne = async (f: Listed) => {
    const p = join(dir, f.name);
    if (!existsSync(p)) await f.download(p);
    return p;
  };

  // קובץ הסניפים: יורד אם עוד לא נטען, או כשצריך אותו לסינון לפי עיר
  const stores = [...latestBy(files.filter((f) => f.meta.kind === "Stores"), (f) => f.meta.chainId + f.meta.subChainId, (f) => f.meta.timestamp).values()];
  const storePaths: string[] = [];
  for (const s of stores) if (opts.city || !loaded.has(s.name)) storePaths.push(await fetchOne(s));

  let storeIds: Set<string> | null = null;
  if (opts.city) {
    const key = normalizeCity(opts.city);
    storeIds = new Set<string>();
    for (const p of storePaths) for (const id of await storesInCity(p, stores[0]!.meta.chainId, key)) storeIds.add(id);
    log(`  ${src.name}: ${storeIds.size} סניפים ב${key}`);
  }

  const plan = planDownloads(files, {
    storeIds, maxStores: opts.maxStores, updates: opts.updates, deltas: opts.deltas, promos: opts.promos, promosOnly: opts.promosOnly, loaded,
  });
  let done = 0;
  let failed = 0;
  const paths = await pool(plan.get, opts.concurrency ?? 6, async (f) => {
    try {
      const p = await fetchOne(f);
      if (++done % 50 === 0) log(`  ${src.name}: ${done}/${plan.get.length}`);
      return p;
    } catch (e) {
      failed++;
      log(`  ! ${f.name}: ${(e as Error).message}`);
      return "";
    }
  });
  const got = paths.filter(Boolean);
  log(`  ${src.name}: ${plan.stores} סניפים · הורדו ${plan.fulls} קבצים מלאים + ${plan.deltas} עדכונים` +
    (plan.skipped ? ` · ${plan.skipped} קבצים מלאים כבר נטענו` : "") + (failed ? ` · ${failed} נכשלו` : "") +
    ` (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
  if (stats) {
    stats.files += got.length + storePaths.length;
    stats.skipped += plan.skipped;
    stats.fulls += plan.fulls;
    stats.deltas += plan.deltas;
    stats.failed += failed;
  }
  return [...storePaths, ...got];
}

/**
 * אוסף כמה רשתות במקביל. onChain נקרא כשרשת סיימה (למשל כדי לטעון אותה למסד בזמן שהאחרות עוד יורדות).
 * מספר ההורדות במקביל מכל אתר מוגבל ב-http.ts, כך שרשתות שיושבות על אותו פורטל לא מעמיסות עליו.
 */
export async function collectChains(
  sources: ChainSource[],
  opts: CollectOptions,
  parallel = 4,
  onChain?: (src: ChainSource, paths: string[]) => void,
): Promise<{ stats: CollectStats; failed: string[] }> {
  const stats: CollectStats = { files: 0, skipped: 0, fulls: 0, deltas: 0, failed: 0 };
  const failed: string[] = [];
  await pool(sources, parallel, async (c) => {
    try {
      const paths = await collectChain(c, opts, stats);
      onChain?.(c, paths);
    } catch (e) {
      failed.push(`${c.name}: ${(e as Error).message}`);
      (opts.log ?? console.log)(`! ${c.name}: ${(e as Error).message}`);
    }
  });
  return { stats, failed };
}

/** אפשרויות האיסוף משורת הפקודה (משותף ל-collect ול-update) */
export function collectArgs(args: string[]): Omit<CollectOptions, "out" | "loaded"> & { parallel: number; all: boolean } {
  const get = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  return {
    city: get("--city"),
    maxStores: get("--max-stores") ? +get("--max-stores")! : undefined,
    updates: args.includes("--updates"),
    deltas: !args.includes("--no-deltas"),
    promos: !args.includes("--no-promos"),
    promosOnly: args.includes("--promos-only"),
    parallel: get("--parallel") ? Math.max(1, +get("--parallel")!) : 4,
    all: args.includes("--all"),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const get = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes("--list")) {
    for (const c of CHAINS) console.log(`${c.id.padEnd(14)} ${c.engine.padEnd(12)} ${c.name}${c.note ? "  — " + c.note : ""}`);
    process.exit(0);
  }
  const ids = (get("--chains") ?? "").split(",").filter(Boolean);
  if (!ids.length) {
    console.error("usage: bun run collect --chains ramilevi,osherad [--city ירושלים] [--max-stores N] [--updates] [--no-deltas] [--no-promos | --promos-only] [--all] [--parallel N] [--out tmp/raw] [--db data/prices.duckdb]\n       bun run collect --list");
    process.exit(1);
  }
  const { parallel, all, ...rest } = collectArgs(args);
  const sources: ChainSource[] = [];
  let unknown = 0;
  for (const id of ids) {
    const c = chainById(id);
    if (!c) { console.error(`רשת לא מוכרת: ${id} (ראו --list)`); unknown++; } else sources.push(c);
  }
  const loaded = all ? new Set<string>() : await loadedFileNames(get("--db") ?? "data/prices.duckdb", console.log);
  const { stats, failed } = await collectChains(sources, { ...rest, out: get("--out") ?? "tmp/raw", loaded }, parallel);
  console.log(`\nהורדו ${stats.fulls} קבצים מלאים + ${stats.deltas} עדכונים; ${stats.skipped} קבצים מלאים כבר נטענו ולא ירדו שוב`);
  if (failed.length || unknown || stats.failed) process.exitCode = 2;
}
