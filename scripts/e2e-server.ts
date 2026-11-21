/**
 * שרת ל-E2E: בונה את האתר ל-web/dist-e2e, מחליף את data/ בנתוני בדיקה סינתטיים
 * (לא נוגע ב-web/public/data האמיתי), ומריץ vite preview.
 */
import { rmSync } from "node:fs";
import { writeSynthetic } from "./gen-synthetic.ts";
import { ingestPaths } from "../src/ingest/cli.ts";
import { exportSite } from "../src/ingest/export.ts";

const port = process.env.E2E_PORT ?? "4174";
const run = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`failed: ${cmd.join(" ")}`);
};

if (!process.env.E2E_SKIP_BUILD) await run(["bunx", "vite", "build", "web", "--outDir", "dist-e2e", "--logLevel", "warn"]);
rmSync("web/dist-e2e/data", { recursive: true, force: true });
rmSync("tmp/e2e", { recursive: true, force: true });
writeSynthetic("tmp/e2e/raw", { updates: true });
await ingestPaths(["tmp/e2e/raw"], { db: "tmp/e2e/db.duckdb" });
await exportSite("tmp/e2e/db.duckdb", "web/dist-e2e/data");
console.log("e2e data ready");
const p = Bun.spawn(["bunx", "vite", "preview", "web", "--outDir", "dist-e2e", "--port", port, "--strictPort"], { stdout: "inherit", stderr: "inherit" });
process.on("SIGTERM", () => p.kill());
process.on("SIGINT", () => p.kill());
await p.exited;
