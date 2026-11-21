/**
 * בונה אתר עם נתוני בדיקה סינתטיים (מסומנים): gen → ingest → export.
 * bun run demo-data [--out web/public/data]
 */
import { rmSync } from "node:fs";
import { writeSynthetic } from "./gen-synthetic.ts";
import { ingestPaths } from "../src/ingest/cli.ts";
import { exportSite } from "../src/ingest/export.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--out");
const out = i >= 0 ? args[i + 1]! : "web/public/data";
const raw = "tmp/synthetic-demo";
const db = "tmp/demo.duckdb";
rmSync(raw, { recursive: true, force: true });
rmSync(db, { force: true });
rmSync(db + ".wal", { force: true });
writeSynthetic(raw, { updates: true });
const res = await ingestPaths([raw], { db });
const bad = res.filter((r) => r.status === "error");
if (bad.length) { console.error(bad); process.exit(1); }
const idx = await exportSite(db, out);
console.log(`TEST data: ${idx.cities.map((c) => `${c.name}(${c.stores})`).join(", ")} → ${out}`);
