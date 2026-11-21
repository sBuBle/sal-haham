/**
 * לוגו רשת מהאתר הרשמי שלה (apple-touch-icon / icon), לרשתות שאין להן לוגו ב-Wikidata.
 *   bun scripts/chain-site-icons.ts
 * שימוש לזיהוי הרשת בלבד. משלים את web/public/img/chains/index.json שנוצר ב-chain-logos.ts.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const OUT = "web/public/img/chains";
const TMP = "tmp/logos";
mkdirSync(TMP, { recursive: true });
const photocraft = process.env.PHOTOCRAFT_CLI ?? (await Array.fromAsync(new Bun.Glob("**/photocraft-cli.exe").scan({ cwd: `${(process.env.LOCALAPPDATA ?? "").replaceAll("\\", "/")}/Programs/ArtCraft/photocraft`, absolute: true })))[0]!;

const SITES: Record<string, string> = {
  "7290492000005": "https://www.doralon.co.il/",
  "7290055700007": "https://www.carrefour.co.il/",
  "7290058140886": "https://www.rami-levy.co.il/",
  "7290873255550": "https://www.tivtaam.co.il/",
  "7290876100000": "https://www.freshmarket.co.il/",
  "7290803800003": "https://yochananof.co.il/",
  "7290103152017": "https://www.osherad.co.il/",
  "7290785400000": "https://www.keshet-teamim.co.il/",
  "7290639000004": "https://www.stopmarket.co.il/",
  "7290058108879": "https://www.kingstore.co.il/",
  "7290058173198": "https://www.zolvebegadol.co.il/",
  "7291059100008": "https://www.politzer.co.il/",
  "7290058156016": "https://www.raimarket.co.il/",
  "7290058159628": "https://www.maayan2000.co.il/",
  "7290875100001": "https://www.superbareket.co.il/",
  "7290526500006": "https://www.dabach.co.il/",
};

const idxPath = `${OUT}/index.json`;
const idx = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, "utf8")) : { logos: {} };

for (const [id, site] of Object.entries(SITES)) {
  if (idx.logos[id]) continue;
  try {
    const html = await (await fetch(site, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) })).text();
    const links = [...html.matchAll(/<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*>/gi)].map((m) => {
      const tag = m[0];
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      const size = +(tag.match(/sizes=["'](\d+)x\d+["']/i)?.[1] ?? (m[1]!.includes("apple") ? 180 : 32));
      return href ? { href: new URL(href, site).href, size } : null;
    }).filter((x): x is { href: string; size: number } => !!x && !x.href.endsWith(".svg"));
    links.sort((a, b) => b.size - a.size);
    const best = links[0];
    if (!best || best.size < 48) { console.log(`- ${id}: no large icon (${links.length} links)`); continue; }
    const raw = `${TMP}/${id}-site.png`;
    await Bun.write(raw, await (await fetch(best.href, { headers: { "User-Agent": UA } })).arrayBuffer());
    const info = Bun.spawnSync([photocraft, "info", raw]).stdout.toString();
    const w = +(info.match(/"width"\s*:\s*(\d+)/)?.[1] ?? 0), h = +(info.match(/"height"\s*:\s*(\d+)/)?.[1] ?? 0);
    if (!w || !h) { console.log(`- ${id}: unreadable ${best.href}`); continue; }
    const s = 112 / Math.max(w, h);
    const pr = Bun.spawnSync([photocraft, "run", "--new", JSON.stringify({ width: 128, height: 128, background: "#ffffff" }),
      "--cmd", "file.placeEmbedded", "--params", JSON.stringify({ path: `${process.cwd().replace(/\\/g, "/")}/${raw}`, scale: Math.round(s * 1000) / 10, fit: false, smartObject: false, center: [64, 64] }),
      "--out", `${OUT}/${id}.webp`]);
    if (pr.exitCode !== 0) { console.log(`- ${id}: photocraft failed`); continue; }
    idx.logos[id] = { file: best.href, src: site, license: "trademark of the chain, shown to identify it" };
    console.log(`+ ${id}: ${best.href} (${w}x${h})`);
  } catch (e) {
    console.log(`- ${id}: ${(e as Error).message.slice(0, 80)}`);
  }
}
writeFileSync(idxPath, JSON.stringify(idx));
console.log(`total logos: ${Object.keys(idx.logos).length}`);
