/**
 * רשימת היישובים הרשמית (data.gov.il, "רשימת יישובים", לפי סמל הלמ"ס): שם, נפה, מועצה אזורית.
 * bun scripts/localities.ts → data/ref/localities.json
 * משמשת בייצוא: (1) קוד יישוב מספרי → שם, (2) יישוב בלי סניפים → הסניפים בנפה שלו.
 */
import { mkdirSync, writeFileSync } from "node:fs";

const RES = "5c78e9fa-c2e2-4771-93ff-7f400a12f7ba";
const rows: any[] = [];
for (let offset = 0; ; offset += 1000) {
  const r = await fetch(`https://data.gov.il/api/3/action/datastore_search?resource_id=${RES}&limit=1000&offset=${offset}`, { headers: { "User-Agent": "sal-haham" } });
  const j: any = await r.json();
  const recs = j.result?.records ?? [];
  rows.push(...recs);
  if (recs.length < 1000) break;
}
const out = rows
  .map((r) => ({
    code: String(parseInt(r["סמל_ישוב"], 10)),
    name: String(r["שם_ישוב"] ?? "").trim(),
    nafa: String(r["שם_נפה"] ?? "").trim(),
    council: String(r["שם_מועצה"] ?? "").trim(),
  }))
  .filter((r) => r.name && r.code !== "0" && r.name !== "לא רשום");
mkdirSync("data/ref", { recursive: true });
writeFileSync("data/ref/localities.json", JSON.stringify({ source: `data.gov.il resource ${RES}`, fetched: new Date().toISOString().slice(0, 10), localities: out }, null, 0));
console.log(`${out.length} localities, ${new Set(out.map((r) => r.nafa)).size} nafot`);
