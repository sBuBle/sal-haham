/** לוגו רשת מקובץ ידוע ב-Wikimedia Commons: bun scripts/chain-logo-file.ts <chain_id> "<File name.svg>" */
import { readFileSync, writeFileSync } from "node:fs";
const [id, file] = process.argv.slice(2) as [string, string];
const UA = "SalHaham/0.1 (open-source grocery price comparison; static site)";
const OUT = "web/public/img/chains";
const photocraft = process.env.PHOTOCRAFT_CLI ?? (await Array.fromAsync(new Bun.Glob("**/photocraft-cli.exe").scan({ cwd: `${(process.env.LOCALAPPDATA ?? "").replaceAll("\\", "/")}/Programs/ArtCraft/photocraft`, absolute: true })))[0]!;
const meta: any = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=256&titles=${encodeURIComponent("File:" + file)}`, { headers: { "User-Agent": UA } })).json();
const ii: any = (Object.values(meta?.query?.pages ?? {})[0] as any)?.imageinfo?.[0];
if (!ii?.thumburl) { console.log("not found:", file); process.exit(1); }
const raw = `tmp/logos/${id}.png`;
await Bun.write(raw, await (await fetch(ii.thumburl, { headers: { "User-Agent": UA } })).arrayBuffer());
const info = Bun.spawnSync([photocraft, "info", raw]).stdout.toString();
const w = +(info.match(/"width"\s*:\s*(\d+)/)?.[1] ?? 0), h = +(info.match(/"height"\s*:\s*(\d+)/)?.[1] ?? 0);
const s = 112 / Math.max(w, h);
Bun.spawnSync([photocraft, "run", "--new", JSON.stringify({ width: 128, height: 128, background: "#ffffff" }),
  "--cmd", "file.placeEmbedded", "--params", JSON.stringify({ path: `${process.cwd().replace(/\\/g, "/")}/${raw}`, scale: Math.round(s * 1000) / 10, fit: false, smartObject: false, center: [64, 64] }),
  "--out", `${OUT}/${id}.webp`]);
const idx = JSON.parse(readFileSync(`${OUT}/index.json`, "utf8"));
idx.logos[id] = { file, src: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`, license: ii.extmetadata?.LicenseShortName?.value ?? "see source" };
writeFileSync(`${OUT}/index.json`, JSON.stringify(idx));
console.log("+", id, file, idx.logos[id].license);
