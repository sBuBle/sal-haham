/**
 * עדכון מלא: איסוף → ingest (הקבצים הגולמיים נמחקים) → ייצוא Parquet לאתר.
 * מיועד ל-cron (GitHub Actions / מחשב ביתי).
 *
 * bun run update [--chains a,b] [--city ירושלים] [--max-stores N] [--updates] [--no-deltas] [--no-promos | --promos-only]
 *                [--all] [--parallel N] [--no-export] [--db data/prices.duckdb] [--out web/public/data]
 *
 * מהיר בריצה חוזרת: קובץ שכבר נטען למסד לא יורד שוב, ואם הקובץ המלא של סניף כבר נטען יורדים רק קובצי העדכון
 * הקטנים שפורסמו אחריו. הרשתות נאספות במקביל (--parallel, ברירת מחדל 4), וכל רשת נטענת למסד ברגע שסיימה לרדת,
 * בזמן שהאחרות עוד יורדות. --all מוריד הכול מחדש. --no-export: בלי ייצוא (למשל כשמריצים כמה עדכונים ברצף).
 * אם לא ירד שום קובץ חדש — אין מה לייצא, והאתר נשאר כמו שהוא.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CHAINS, chainById, type ChainSource } from "../src/collect/chains.ts";
import { collectArgs, collectChains } from "../src/collect/cli.ts";
import { loadedFileNames } from "../src/collect/loaded.ts";
import { ingestInto } from "../src/ingest/cli.ts";
import { PriceDb, type IngestResult } from "../src/ingest/db.ts";
import { exportSite } from "../src/ingest/export.ts";

const args = process.argv.slice(2);
const get = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const dbPath = get("--db") ?? "data/prices.duckdb";
const out = get("--out") ?? "web/public/data";
const raw = get("--raw") ?? "tmp/raw";
const ids = get("--chains")?.split(",") ?? CHAINS.filter((c) => c.make).map((c) => c.id);
const { parallel, all, ...collectOpts } = collectArgs(args);
const min = (ms: number) => (ms / 60000).toFixed(1);

const t0 = performance.now();
const failed: string[] = [];
const sources: ChainSource[] = [];
for (const id of ids) {
  const c = chainById(id);
  if (!c) failed.push(`${id}: unknown`); else sources.push(c);
}

// מה כבר נטען (קריאה בלבד, נסגר מיד), ואז המסד נפתח לכתיבה לכל זמן האיסוף
const loaded = all ? new Set<string>() : await loadedFileNames(dbPath, console.log);
const db = await PriceDb.open(dbPath);
const results: IngestResult[] = [];
let ingestMs = 0;
// תור טעינה: רשת שסיימה לרדת נטענת מיד (אחת בכל פעם), בזמן שהאחרות עוד יורדות
let queue: Promise<void> = Promise.resolve();
let collected!: Awaited<ReturnType<typeof collectChains>>;
try {
  collected = await collectChains(sources, { ...collectOpts, out: raw, loaded }, parallel, (_src, paths) => {
    queue = queue.then(async () => {
      const t = performance.now();
      results.push(...(await ingestInto(db, paths, { log: (r) => r.status === "error" && console.error(`! ${r.file}: ${r.message}`) })));
      ingestMs += performance.now() - t;
    });
  });
  const tCollect = performance.now() - t0;
  await queue;
  await db.run("CHECKPOINT");
  console.log(`collect: ${collected.stats.fulls} full + ${collected.stats.deltas} update files downloaded, ${collected.stats.skipped} already loaded (skipped) — ${min(tCollect)} min`);
} finally {
  await db.close();
}
failed.push(...collected.failed);
rmSync(raw, { recursive: true, force: true }); // לא שומרים XML גולמי
const nLoaded = results.filter((r) => r.status === "loaded").length;
const errors = results.filter((r) => r.status === "error").length;
console.log(`ingest: ${nLoaded} loaded, ${results.length - nLoaded - errors} skipped, ${errors} errors — ${min(ingestMs)} min (overlaps the download)`);

if (args.includes("--no-export")) {
  console.log("export: skipped (--no-export)");
} else if (nLoaded === 0 && !args.includes("--force-export") && existsSync(join(out, "index.json"))) {
  console.log("export: nothing new was loaded, the site data is unchanged (use --force-export to export anyway)");
} else {
  const t = performance.now();
  const idx = await exportSite(dbPath, out);
  console.log(`export: ${idx.cities.length} cities, ${idx.totals.stores} stores, ${idx.totals.prices} prices, ${idx.totals.promos ?? 0} deals → ${out} — ${min(performance.now() - t)} min`);
}
console.log(`done in ${min(performance.now() - t0)} min`);
if (failed.length) {
  console.error(`\nchains that failed:\n  ${failed.join("\n  ")}`);
  // לא נכשלים אם רק חלק מהרשתות נפלו — האתר עדיין מתעדכן
  if (failed.length === ids.length) process.exit(2);
}
