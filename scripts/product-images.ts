/**
 * תמונות מוצר אמיתיות מ-Open Food Facts (לפי ברקוד), על רקע לבן, לאתר.
 *   bun scripts/product-images.ts [--top 2000] [--probe 50]
 *
 * - המוצרים הנפוצים ביותר (n_stores) מכל הארץ, לפי all/products.parquet.
 * - לכל ברקוד: API v2 של OFF (שדות תמונה בלבד). אין תמונה → מדלגים (האתר מציג אייקון קו).
 * - התמונה עוברת PhotoCraft: התאמה ל-320×320 על קנבס לבן, WebP.
 * - web/public/img/p/{barcode}.webp + web/public/img/p/index.json (רשימה + קרדיט לכל תמונה).
 * רישיון: תמונות OFF הן CC BY-SA 3.0 — חובה לציין מקור (מוצג בדף המוצר ובקרדיטים).
 * רק מוצרים קיימים: לא מייצרים ולא "משפרים" תמונה מעבר להקטנה ורקע לבן.
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1]! : d);
const TOP = +get("--top", "2000");
const PROBE = args.includes("--probe") ? +get("--probe", "50") : 0;
const OUT = "web/public/img/p";
const TMP = "tmp/img";
const UA = "SalHaham/0.1 (open-source grocery price comparison; static site)";
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const photocraft = process.env.PHOTOCRAFT_CLI ?? (await Array.fromAsync(new Bun.Glob("**/photocraft-cli.exe").scan({ cwd: `${(process.env.LOCALAPPDATA ?? "").replaceAll("\\", "/")}/Programs/ArtCraft/photocraft`, absolute: true })))[0]!;

const inst = await DuckDBInstance.create();
const con = await inst.connect();
const r = await con.runAndReadAll(`SELECT barcode, name FROM read_parquet('web/public/data/all/products.parquet')
  WHERE length(barcode) >= 8 ORDER BY n_stores DESC, barcode LIMIT ${PROBE || TOP}`);
const rows = r.getRowObjectsJson() as { barcode: string; name: string }[];

const idxPath = `${OUT}/index.json`;
const index: Record<string, { src: string; by: string; license: string }> = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, "utf8")).images : {};
const tried: Record<string, number> = existsSync(`${TMP}/tried.json`) ? JSON.parse(readFileSync(`${TMP}/tried.json`, "utf8")) : {};

let found = 0, missing = 0, n = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (const { barcode } of rows) {
  n++;
  if (index[barcode]) { found++; continue; }
  if (tried[barcode] && !PROBE) { missing++; continue; }
  try {
    // OFF: עד 100 קריאות מוצר לדקה
    await sleep(650);
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=code,image_front_url,image_url`, { headers: { "User-Agent": UA } });
    const j = res.ok ? ((await res.json()) as any) : null;
    const img: string | undefined = j?.product?.image_front_url ?? j?.product?.image_url;
    if (!img) { missing++; tried[barcode] = Date.now(); continue; }
    if (PROBE) { found++; continue; }
    const bin = await fetch(img, { headers: { "User-Agent": UA } });
    if (!bin.ok) { missing++; tried[barcode] = Date.now(); continue; }
    const raw = `${TMP}/${barcode}.jpg`;
    await Bun.write(raw, await bin.arrayBuffer());
    // PhotoCraft: מקטינים כך שהצלע הארוכה 300px, ומניחים במרכז קנבס לבן 320×320
    const info = Bun.spawnSync([photocraft, "info", raw]).stdout.toString();
    const w = +(info.match(/"width"\s*:\s*(\d+)/)?.[1] ?? 0), h = +(info.match(/"height"\s*:\s*(\d+)/)?.[1] ?? 0);
    if (!w || !h) { missing++; continue; }
    const s = 300 / Math.max(w, h);
    const cmd = [photocraft, "run", raw,
      "--cmd", "image.imageSize", "--params", JSON.stringify({ width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), resample: "lanczos" }),
      "--cmd", "image.canvasSize", "--params", JSON.stringify({ width: 320, height: 320, anchor: "center", extensionColor: "#ffffff" }),
      "--out", `${OUT}/${barcode}.webp`];
    const pr = Bun.spawnSync(cmd);
    if (pr.exitCode !== 0) { missing++; continue; }
    index[barcode] = { src: `https://world.openfoodfacts.org/product/${barcode}`, by: "Open Food Facts contributors", license: "CC BY-SA 3.0" };
    found++;
  } catch (e) {
    missing++;
  }
  if (n % 50 === 0) {
    console.log(`${n}/${rows.length}: ${found} with photo, ${missing} without`);
    if (!PROBE) {
      writeFileSync(idxPath, JSON.stringify({ source: "Open Food Facts", license: "CC BY-SA 3.0", images: index }));
      writeFileSync(`${TMP}/tried.json`, JSON.stringify(tried));
    }
  }
}
if (!PROBE) {
  writeFileSync(idxPath, JSON.stringify({ source: "Open Food Facts", license: "CC BY-SA 3.0", images: index }));
  writeFileSync(`${TMP}/tried.json`, JSON.stringify(tried));
}
console.log(`done: ${found} of ${rows.length} with photo (${Math.round((found / rows.length) * 100)}%)`);
