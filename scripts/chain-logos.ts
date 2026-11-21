/**
 * לוגו לכל רשת: Wikidata (מאפיין P154 "logo image") → קובץ ב-Wikimedia Commons.
 *   bun scripts/chain-logos.ts
 * רק לוגואים שמוגדרים רשמית ב-Wikidata לישות של הרשת. השימוש: זיהוי הרשת (שימוש תיאורי, כמו באתרי השוואה).
 * הקובץ עובר PhotoCraft: התאמה לריבוע לבן 128×128. מי שאין לו לוגו נשאר עם ראשי תיבות.
 * פלט: web/public/img/chains/{chain_id}.webp + index.json (מקור ורישיון לכל לוגו).
 */
import { mkdirSync, writeFileSync } from "node:fs";

const UA = "SalHaham/0.1 (open-source grocery price comparison; static site)";
const OUT = "web/public/img/chains";
const TMP = "tmp/logos";
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const photocraft = process.env.PHOTOCRAFT_CLI ?? (await Array.fromAsync(new Bun.Glob("**/photocraft-cli.exe").scan({ cwd: `${(process.env.LOCALAPPDATA ?? "").replaceAll("\\", "/")}/Programs/ArtCraft/photocraft`, absolute: true })))[0]!;

// chain_id → כותרות ערכים בוויקיפדיה (עברית, ואז אנגלית)
const TITLES: Record<string, string[]> = {
  "7290027600007": ["he:שופרסל", "en:Shufersal"],
  "7290644700005": ["he:פז (חברה)", "en:Paz Oil Company"],
  "7290492000005": ["he:דור אלון", "en:Dor Alon"],
  "7290055700007": ["he:קרפור ישראל", "en:Carrefour"],
  "7290058140886": ["he:רמי לוי שיווק השקמה", "en:Rami Levy Hashikma Marketing"],
  "7290058156016": ["he:ראי מרקט"],
  "7290873255550": ["he:טיב טעם", "en:Tiv Taam"],
  "7290876100000": ["he:פרש מרקט"],
  "7290058108879": ["he:קינג סטור"],
  "7290803800003": ["he:יוחננוף", "en:Yochananof"],
  "7290058159628": ["he:מעיין 2000"],
  "7290058173198": ["he:זול ובגדול"],
  "7290103152017": ["he:אושר עד", "en:Osher Ad"],
  "7290058148776": ["he:שוק העיר"],
  "7290785400000": ["he:קשת טעמים"],
  "7290875100001": ["he:סופר ברקת"],
  "7290639000004": ["he:סטופמרקט", "he:סטופ מרקט"],
  "7290526500006": ["he:סאלח דבאח"],
  "7291059100008": ["he:פוליצר (רשת)", "he:פוליצר"],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ויקימדיה מגבילה קצב: השהיה בין בקשות, וניסיון חוזר על 429 */
async function json(url: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    await sleep(1500 * (i + 1));
    const r = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
    const s = await r.text();
    try { return JSON.parse(s); } catch { /* 429 / html */ }
  }
  return null;
}
const index: Record<string, { file: string; src: string; license: string }> = {};

for (const [id, titles] of Object.entries(TITLES)) {
  let file: string | null = null;
  for (const t of titles) {
    const [lang, title] = t.split(":") as [string, string];
    const q = await json(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&redirects=1&titles=${encodeURIComponent(title)}`);
    const page: any = Object.values(q?.query?.pages ?? {})[0];
    const qid = page?.pageprops?.wikibase_item;
    if (!qid) continue;
    const e = await json(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    const claim = e?.entities?.[qid]?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
    if (claim) { file = claim; break; }
  }
  if (!file) { console.log(`- ${id}: no logo`); continue; }
  const meta = await json(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=256&titles=${encodeURIComponent("File:" + file)}`);
  const ii: any = (Object.values(meta?.query?.pages ?? {})[0] as any)?.imageinfo?.[0];
  const thumb = ii?.thumburl ?? ii?.url;
  if (!thumb) { console.log(`- ${id}: ${file} has no url`); continue; }
  const raw = `${TMP}/${id}.png`;
  await Bun.write(raw, await (await fetch(thumb, { headers: { "User-Agent": UA } })).arrayBuffer());
  const info = Bun.spawnSync([photocraft, "info", raw]).stdout.toString();
  const w = +(info.match(/"width"\s*:\s*(\d+)/)?.[1] ?? 0), h = +(info.match(/"height"\s*:\s*(\d+)/)?.[1] ?? 0);
  if (!w || !h) { console.log(`- ${id}: unreadable`); continue; }
  const s = 112 / Math.max(w, h);
  // שקיפות → לבן: קנבס לבן חדש והלוגו מוצב במרכזו
  const pr = Bun.spawnSync([photocraft, "run", "--new", JSON.stringify({ width: 128, height: 128, background: "#ffffff" }),
    "--cmd", "file.placeEmbedded", "--params", JSON.stringify({ path: `${process.cwd().replace(/\\/g, "/")}/${raw}`, scale: Math.round(s * 1000) / 10, fit: false, smartObject: false, center: [64, 64] }),
    "--out", `${OUT}/${id}.webp`]);
  if (pr.exitCode !== 0) { console.log(`- ${id}: photocraft failed ${pr.stderr.toString().slice(0, 120)}`); continue; }
  const lic = ii?.extmetadata?.LicenseShortName?.value ?? "see source";
  index[id] = { file, src: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`, license: lic };
  console.log(`+ ${id}: ${file} (${lic})`);
}
writeFileSync(`${OUT}/index.json`, JSON.stringify({ source: "Wikidata P154 / Wikimedia Commons", logos: index }));
console.log(`done: ${Object.keys(index).length} of ${Object.keys(TITLES).length} chains`);
