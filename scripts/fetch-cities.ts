/**
 * מוריד את רשימת היישובים הרשמית של הלמ"ס מ-data.gov.il ושומר מיפוי קוד → שם
 * ב-data/ref/cities.json. משמש לרשתות שמפרסמות City כקוד מספרי (למשל רמי לוי: 3000 = ירושלים).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { CITY_REF_PATH } from "../src/ingest/cities.ts";

const RESOURCE = "5c78e9fa-c2e2-4771-93ff-7f400a12f7ba";
const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${RESOURCE}&limit=5000`;
const res = await fetch(url, { headers: { "User-Agent": "sal-haham/0.1" } });
if (!res.ok) throw new Error(`data.gov.il ${res.status}`);
const json: any = await res.json();
const codes: Record<string, string> = {};
for (const r of json.result.records) {
  const code = String(parseInt(String(r["סמל_ישוב"]).trim(), 10));
  const name = String(r["שם_ישוב"] ?? "").replace(/\s+/g, " ").trim();
  if (code && code !== "NaN" && name) codes[code] = name;
}
mkdirSync("data/ref", { recursive: true });
writeFileSync(
  CITY_REF_PATH,
  JSON.stringify({ source: "data.gov.il — רשימת יישובים (למ\"ס)", resource: RESOURCE, fetchedAt: new Date().toISOString(), codes }, null, 1),
);
console.log(`saved ${Object.keys(codes).length} city codes → ${CITY_REF_PATH}`);
