/** bun run export [--db data/prices.duckdb] [--out web/public/data] [--stale-days 7] */
import { exportSite } from "./export.ts";

const args = process.argv.slice(2);
const get = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1]! : d;
};
const t0 = performance.now();
const idx = await exportSite(get("--db", "data/prices.duckdb"), get("--out", "web/public/data"), {
  staleDays: +get("--stale-days", "7"),
  log: args.includes("-v") ? console.log : undefined,
});
const size = Object.values(idx.files).reduce((a, b) => a + b, 0);
console.log(
  `exported ${idx.cities.length} cities, ${idx.totals.stores} stores, ${idx.totals.products} products, ${idx.totals.prices} prices` +
    ` — ${(size / 1e6).toFixed(1)} MB${idx.testData ? "  [TEST DATA]" : ""} (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
);
