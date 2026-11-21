/**
 * לוגו רשת מאייקון האפליקציה הרשמית שלה ב-App Store (iTunes Search API, ציבורי), או מתמונת הערך בוויקיפדיה העברית.
 *   bun scripts/chain-app-icons.ts            → מדפיס מועמדים (dry run)
 *   bun scripts/chain-app-icons.ts --apply    → מוריד את המאושרים ב-PICK ומעדכן index.json
 * שימוש לזיהוי הרשת בלבד. כל מועמד נבדק ידנית (שם המפתח = הרשת) לפני שמכניסים ל-PICK.
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "web/public/img/chains";
const UA = "SalHaham/0.1 (open-source grocery price comparison; static site)";
const photocraft = process.env.PHOTOCRAFT_CLI ?? (await Array.fromAsync(new Bun.Glob("**/photocraft-cli.exe").scan({ cwd: `${(process.env.LOCALAPPDATA ?? "").replaceAll("\\", "/")}/Programs/ArtCraft/photocraft`, absolute: true })))[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MISSING: Record<string, string[]> = {
  "7290055700007": ["קרפור", "Carrefour Israel"],
  "7290058140886": ["רמי לוי", "Rami Levy"],
  "7290058156016": ["ראי מרקט"],
  "7290873255550": ["טיב טעם", "Tiv Taam"],
  "7290876100000": ["פרש מרקט", "Fresh Market"],
  "7290058108879": ["קינג סטור", "King Store"],
  "7290058159628": ["מעיין 2000"],
  "7290058173198": ["זול ובגדול"],
  "7290058148776": ["שוק העיר"],
  "7290785400000": ["קשת טעמים"],
  "7290875100001": ["סופר ברקת"],
  "7290526500006": ["סאלח דבאח", "Dabach"],
  "7291059100008": ["פוליצר"],
};

// אושרו ידנית אחרי dry run: chain_id → כתובת אייקון
const PICK: Record<string, { url: string; from: string }> = JSON.parse(process.env.PICK ?? "{}");

if (!process.argv.includes("--apply")) {
  for (const [id, terms] of Object.entries(MISSING)) {
    for (const term of terms) {
      await sleep(1200);
      const r: any = await (await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=il&limit=4`, { headers: { "User-Agent": UA } })).json().catch(() => null);
      for (const a of r?.results ?? []) console.log(`${id}\t${term}\t${a.trackName}\t| dev: ${a.sellerName ?? a.artistName}\t${a.artworkUrl512}`);
    }
  }
  process.exit(0);
}

const idx = JSON.parse(readFileSync(`${OUT}/index.json`, "utf8"));
for (const [id, { url, from }] of Object.entries(PICK)) {
  const raw = `tmp/logos/${id}-app.png`;
  await Bun.write(raw, await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
  const info = Bun.spawnSync([photocraft, "info", raw]).stdout.toString();
  const w = +(info.match(/"width"\s*:\s*(\d+)/)?.[1] ?? 0), h = +(info.match(/"height"\s*:\s*(\d+)/)?.[1] ?? 0);
  if (!w || !h) { console.log("unreadable", id); continue; }
  const s = 128 / Math.max(w, h);
  const pr = Bun.spawnSync([photocraft, "run", "--new", JSON.stringify({ width: 128, height: 128, background: "#ffffff" }),
    "--cmd", "file.placeEmbedded", "--params", JSON.stringify({ path: `${process.cwd().replace(/\\/g, "/")}/${raw}`, scale: Math.round(s * 1000) / 10, fit: false, smartObject: false, center: [64, 64] }),
    "--out", `${OUT}/${id}.webp`]);
  if (pr.exitCode !== 0) { console.log("photocraft failed", id); continue; }
  idx.logos[id] = { file: url, src: from, license: "trademark of the chain, shown to identify it" };
  console.log("+", id);
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(idx));
console.log("total", Object.keys(idx.logos).length);
