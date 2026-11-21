/**
 * bun run ingest [--db data/prices.duckdb] [--keep] <קבצים או תיקיות...>
 *
 * טוען קבצים לפי הסדר: Stores קודם, אחר כך מחירים לפי זמן הקובץ.
 * ברירת המחדל: מוחק כל קובץ גולמי אחרי שנטען בהצלחה (או זוהה ככפול) — לא שומרים XML.
 */
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PriceDb, type IngestResult } from "./db.ts";
import { parseFileName, ingestOrder } from "./filename.ts";
import { loadCityCodes } from "./cities.ts";

function listFiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listFiles(readdirSync(p).map((f) => join(p, f))));
    else out.push(p);
  }
  return out;
}

/** כמה קבצים בטרנזקציה אחת */
const BATCH = Math.max(1, Number(process.env.INGEST_BATCH ?? 25));

/**
 * טוען קבצים למסד פתוח, לפי הסדר (Stores, ואז לפי זמן הקובץ). קובץ שנטען או זוהה ככפול נמחק (אלא אם keep).
 * הקבצים נטענים באצוות של BATCH בטרנזקציה אחת. אם קובץ באצווה נכשל, האצווה מתבטלת ונטענת מחדש קובץ-קובץ,
 * כך שקובץ פגום אחד לא מפיל את האחרים. קובץ גולמי נמחק רק אחרי שהטרנזקציה שלו נסגרה.
 */
export async function ingestInto(
  db: PriceDb,
  paths: string[],
  opts: { keep?: boolean; log?: (r: IngestResult) => void } = {},
): Promise<IngestResult[]> {
  const files = listFiles(paths.filter((p) => existsSync(p)))
    .map((f) => ({ f, meta: parseFileName(f) }))
    .sort((a, b) => (a.meta && b.meta ? ingestOrder(a.meta, b.meta) : a.meta ? -1 : 1));
  const cityCodes = loadCityCodes();
  const results: IngestResult[] = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    let out: IngestResult[] = [];
    if (chunk.length > 1) {
      await db.beginBatch();
      for (const { f } of chunk) {
        const r = await db.ingestFile(f, { cityCodes });
        out.push(r);
        if (!db.inBatch) break; // שגיאה: האצווה בוטלה
      }
      if (!(await db.commitBatch())) out = [];
    }
    if (!out.length) for (const { f } of chunk) out.push(await db.ingestFile(f, { cityCodes }));
    out.forEach((r, j) => {
      results.push(r);
      opts.log?.(r);
      if (!opts.keep && (r.status === "loaded" || r.status === "skipped-duplicate" || r.status === "skipped-kind")) {
        try { unlinkSync(chunk[j]!.f); } catch {}
      }
    });
  }
  return results;
}

export async function ingestPaths(
  paths: string[],
  opts: { db: string; keep?: boolean; log?: (r: IngestResult) => void; memoryLimit?: string },
): Promise<IngestResult[]> {
  const db = await PriceDb.open(opts.db, { memoryLimit: opts.memoryLimit });
  try {
    const results = await ingestInto(db, paths, opts);
    await db.run("CHECKPOINT");
    return results;
  } finally {
    await db.close();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let db = "data/prices.duckdb";
  let keep = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--db") db = args[++i]!;
    else if (a === "--keep") keep = true;
    else paths.push(a);
  }
  if (!paths.length) {
    console.error("usage: bun run ingest [--db data/prices.duckdb] [--keep] <files|dirs...>");
    process.exit(1);
  }
  const t0 = performance.now();
  const results = await ingestPaths(paths, {
    db,
    keep,
    log: (r) =>
      console.log(
        `${r.status.padEnd(18)} ${r.file}` +
          (r.rows != null ? `  rows=${r.rows}` : "") +
          (r.newHistory != null ? ` hist+${r.newHistory}` : "") +
          (r.encoding ? ` [${r.compression}/${r.encoding}]` : "") +
          (r.parseErrors ? ` xml-errors=${r.parseErrors}` : "") +
          (r.message ? `  — ${r.message}` : ""),
      ),
  });
  const by = (s: string) => results.filter((r) => r.status === s).length;
  console.log(
    `\n${results.length} files: loaded=${by("loaded")} dup=${by("skipped-duplicate")} promo=${by("skipped-kind")} unknown=${by("skipped-name")} error=${by("error")}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
  );
  if (by("error")) process.exitCode = 2;
}
