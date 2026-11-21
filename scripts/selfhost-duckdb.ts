/**
 * אירוח עצמי של ה-Parquet extension של DuckDB-WASM (לעבודה בלי extensions.duckdb.org).
 * מוריד את ה-extension לגרסת ה-DuckDB שארוזה ב-@duckdb/duckdb-wasm אל
 * web/public/duckdb/ext/{version}/{wasm_eh|wasm_mvp}/parquet.duckdb_extension.wasm
 *
 * אחר כך בונים עם:  VITE_DUCKDB_EXT_REPO=./duckdb/ext bun run build
 * (ה-wasm וה-worker של DuckDB עצמם כבר נארזים עם האתר כברירת מחדל.)
 *
 * bun run selfhost-duckdb [--version v1.5.4] [--extensions parquet,json]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const get = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);

function detectVersion(): string {
  const bin = readFileSync("node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm").toString("latin1");
  const counts = new Map<string, number>();
  for (const m of bin.matchAll(/\bv(\d+\.\d+\.\d+)(?=[\s\0])/g)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  // הגרסה של הספרייה היא הגבוהה מבין המחרוזות (שאר המופעים הם הודעות היסטוריות)
  const versions = [...counts.keys()].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!versions.length) throw new Error("לא זוהתה גרסת DuckDB; העבירו --version");
  return "v" + versions[0];
}

const version = get("--version") ?? detectVersion();
const exts = (get("--extensions") ?? "parquet").split(",");
const out = "web/public/duckdb/ext";
for (const platform of ["wasm_eh", "wasm_mvp"]) {
  for (const ext of exts) {
    const dir = join(out, version, platform);
    const file = join(dir, `${ext}.duckdb_extension.wasm`);
    if (existsSync(file)) { console.log(`exists ${file}`); continue; }
    const url = `https://extensions.duckdb.org/${version}/${platform}/${ext}.duckdb_extension.wasm`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
    console.log(`saved ${file}`);
  }
}
console.log(`\nבנו עם: VITE_DUCKDB_EXT_REPO=./duckdb/ext bun run build   (DuckDB ${version})`);
