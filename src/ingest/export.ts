/**
 * ייצוא לאתר הסטטי:
 *   data/index.json                      — ערים, רשתות, זמן עדכון, דגל נתוני בדיקה
 *   data/cities/{slug}/stores.json       — סניפי העיר
 *   data/cities/{slug}/products.parquet  — מוצרים שנמכרים בעיר (+ מפתח חיפוש, מחיר מינ'/מקס')
 *   data/cities/{slug}/prices.parquet    — barcode, chain_id, store_id, price_ag
 *   data/cities/{slug}/promos.parquet    — מבצעים תקפים: barcode, chain_id, store_id, club, min_qty, total_ag, max_qty, min_purchase_ag, ends, descr
 *   data/all/*                           — אותו דבר לכל הארץ (נקרא ב-HTTP Range)
 * Parquet ב-zstd, ממוין לפי barcode, chain_id, store_id.
 * מחיר שלא נראה זמן רב (last_seen) לא מיוצא; סניף שלא עודכן זמן רב מסומן stale.
 */
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PriceDb } from "./db.ts";
import { SEARCH_KEY_SQL, sqlString } from "../shared/search.ts";
import { placeOf } from "../shared/categories.ts";
import { normalizeCity } from "../shared/city.ts";
import { CODE_CITY, STORE_CITY } from "./store-cities.ts";
import { dealAggSql } from "../shared/promo.ts";

/** שם תצוגה לרשתות שמפרסמות שם ריק, באנגלית או בשם החברה המשפטי */
const CHAIN_NAMES: Record<string, string> = {
  "7290700100008": "חצי חינם",
  "7290492000005": "דור אלון",
  "7290526500006": "סאלח דבאח",
  "7290644700005": "יילו (פז)",
  "7290172900007": "סופר-פארם",
  "7290058197699": "גוד פארם",
  "7290058108879": "קינג סטור",
  "7290058159628": "מעיין 2000",
  "7290058173198": "זול ובגדול",
  "7290058148776": "שוק העיר",
  "7290875100001": "סופר ברקת",
  "7290058140886": "רמי לוי",
  "7290803800003": "יוחננוף",
};
const CHAIN_NAME_SQL = `CASE s.chain_id ${Object.entries(CHAIN_NAMES).map(([id, n]) => `WHEN '${id}' THEN '${n}'`).join(" ")} END`;

export interface ExportOptions {
  /** מחיר שלא הופיע X ימים לפני העדכון האחרון של אותו סניף — לא מיוצא */
  staleDays?: number;
  /** סניף שהעדכון האחרון שלו ישן ב-X ימים מהעדכון האחרון בכלל — מסומן stale */
  storeStaleDays?: number;
  rowGroupSize?: number;
  /** "YYYY-MM-DD HH:MM:SS" (שעון ישראל): מבצעים שלא התחילו או שהסתיימו לא מיוצאים. ברירת מחדל: עכשיו. */
  now?: string;
  log?: (s: string) => void;
}

export interface CityEntry {
  key: string;
  name: string;
  slug: string;
  stores: number;
  chains: number;
  /** לאזור: הערים שבו */
  cities?: string[];
}

export interface Locality { code: string; name: string; nafa: string; council: string }
export function loadLocalities(path = "data/ref/localities.json"): Locality[] {
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, "utf8")) as { localities: Locality[] }).localities;
}

export interface SiteIndex {
  version: number;
  generatedAt: string;
  dataUpdatedAt: string | null;
  testData: boolean;
  chains: { id: string; name: string; stores: number }[];
  cities: CityEntry[];
  /** אזורים (נפות): כל הסניפים בכמה ערים קרובות */
  areas?: CityEntry[];
  /** יישובים בלי סניפים משלהם: שם מנורמל → slug של האזור */
  localities?: { n: string; a: string }[];
  totals: { stores: number; products: number; prices: number; promos?: number };
  files: Record<string, number>;
}

/** עכשיו בשעון ישראל, "YYYY-MM-DD HH:MM:SS" (התאריכים בקובצי הרשתות הם בשעון ישראל) */
export const israelNow = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "medium" }).format(d);

export const citySlug = (key: string) => "c" + createHash("sha256").update(key, "utf8").digest("hex").slice(0, 10);

const posix = (p: string) => p.replace(/\\/g, "/");

export async function exportSite(dbPath: string, outDir: string, opts: ExportOptions = {}): Promise<SiteIndex> {
  const log = opts.log ?? (() => {});
  const staleDays = opts.staleDays ?? 7;
  const storeStaleDays = opts.storeStaleDays ?? 14;
  const rg = opts.rowGroupSize ?? 50000;
  const db = await PriceDb.open(dbPath);
  const files: Record<string, number> = {};
  const parquet = async (sql: string, rel: string) => {
    const path = join(outDir, rel);
    await db.run(`COPY (${sql}) TO ${sqlString(posix(path))} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE ${rg})`);
    files[rel.replace(/\\/g, "/")] = statSync(path).size;
  };
  const json = (rel: string, obj: unknown) => {
    const path = join(outDir, rel);
    const s = JSON.stringify(obj);
    writeFileSync(path, s);
    files[rel.replace(/\\/g, "/")] = Buffer.byteLength(s);
  };

  try {
    mkdirSync(outDir, { recursive: true });
    for (const d of ["cities", "all"]) if (existsSync(join(outDir, d))) rmSync(join(outDir, d), { recursive: true, force: true });
    mkdirSync(join(outDir, "all"), { recursive: true });

    await db.run(`CREATE OR REPLACE TEMP TABLE live_prices AS
      SELECT cp.chain_id, cp.store_id, cp.barcode, cp.price_ag
      FROM current_prices cp
      JOIN (SELECT chain_id, store_id, max(last_seen) AS mx FROM current_prices GROUP BY ALL) m USING (chain_id, store_id)
      WHERE cp.last_seen >= m.mx - INTERVAL ${staleDays} DAY AND cp.price_ag > 0`);
    await db.run(`CREATE OR REPLACE TEMP TABLE exp_stores AS
      WITH seen AS (SELECT chain_id, store_id, max(last_seen) AS last_seen FROM current_prices GROUP BY ALL),
           g AS (SELECT max(last_seen) AS mx FROM current_prices)
      SELECT s.chain_id, s.store_id,
        coalesce(${CHAIN_NAME_SQL}, nullif(s.chain_name, ''), nullif(c.chain_name, ''), s.chain_id) AS chain_name,
        coalesce(nullif(s.store_name, ''), 'סניף ' || s.store_id) AS store_name,
        s.city, s.city_key, coalesce(s.address, '') AS address,
        strftime(seen.last_seen, '%Y-%m-%d %H:%M') AS updated,
        seen.last_seen < g.mx - INTERVAL ${storeStaleDays} DAY AS stale
      FROM stores s
      JOIN seen USING (chain_id, store_id)
      LEFT JOIN chains c USING (chain_id)
      CROSS JOIN g`);
    // סניפים בלי עיר בקובץ הרשת: עיר מרשימה שנבדקה ידנית (store-cities.ts). ניחוש אוטומטי מהכתובת נוסה ונפסל:
    // "רחוב", "אלון", "אזור" הם גם שמות יישובים, ו"ירושלים 1" הוא רחוב. מה שלא ברשימה — לא מוצג.
    const blank = await db.all<{ chain_id: string; store_id: string; store_name: string }>(
      `SELECT chain_id, store_id, s.store_name FROM exp_stores s WHERE coalesce(city_key, '') = ''`);
    if (blank.length) {
      const raw = await db.all<{ chain_id: string; store_id: string; store_name: string }>(
        `SELECT chain_id, store_id, store_name FROM stores WHERE coalesce(city_key, '') = ''`);
      const rawName = new Map(raw.map((r) => [`${r.chain_id}|${r.store_id}`, r.store_name ?? ""]));
      const fixed = blank
        .map((s) => ({ ...s, key: normalizeCity(STORE_CITY[`${s.chain_id}|${rawName.get(`${s.chain_id}|${s.store_id}`) ?? s.store_name}`] ?? "") }))
        .filter((s) => s.key);
      const f = join(outDir, "_city.csv").replace(/\\/g, "/");
      writeFileSync(f, "chain_id,store_id,city_key\n" + fixed.map((s) => [s.chain_id, s.store_id, s.key].map((x) => `"${x.replace(/"/g, '""')}"`).join(",")).join("\n"));
      if (fixed.length) {
        await db.run(`UPDATE exp_stores SET city_key = c.city_key, city = c.city_key
          FROM read_csv('${f}', header = true, all_varchar = true) c
          WHERE exp_stores.chain_id = c.chain_id AND exp_stores.store_id = c.store_id`);
      }
      rmSync(f);
      log(`  stores without a city: ${blank.length}, city found from name/address for ${fixed.length}`);
    }
    await db.run(`DELETE FROM exp_stores WHERE coalesce(city_key, '') = ''`);
    // "קוד יישוב N": קוד שלא תורגם בזמן הטעינה → שם מרשימת היישובים הרשמית, או מהרשימה הידנית
    const codeName = new Map(loadLocalities().map((l) => [l.code, l.name]));
    for (const [k, v] of Object.entries(CODE_CITY)) codeName.set(k, v);
    for (const r of await db.all<{ k: string }>(`SELECT DISTINCT city_key AS k FROM exp_stores WHERE city_key LIKE 'קוד יישוב %'`)) {
      const name = codeName.get(r.k.replace("קוד יישוב ", "").trim());
      if (name) await db.run(`UPDATE exp_stores SET city_key = $n, city = $n WHERE city_key = $k`, { n: normalizeCity(name), k: r.k });
    }
    await db.run(`CREATE OR REPLACE TEMP TABLE exp_prices AS
      SELECT p.barcode, p.chain_id, p.store_id, p.price_ag, s.city_key
      FROM live_prices p JOIN exp_stores s USING (chain_id, store_id)`);
    await db.run(`CREATE OR REPLACE TEMP TABLE exp_products AS
      SELECT barcode, trim(regexp_replace(name, '^[\\*\\-\\.\\s#!+]+', '')) AS name, coalesce(manufacturer, '') AS manufacturer, quantity, coalesce(unit_qty, '') AS unit_qty,
        coalesce(uom, '') AS uom, coalesce(is_weighted, false) AS is_weighted,
        ${SEARCH_KEY_SQL("coalesce(name, '') || ' ' || coalesce(manufacturer, '')")} AS search_key
      FROM products WHERE barcode IN (SELECT DISTINCT barcode FROM exp_prices)`);

    // 1) פריטים שאינם מוצרים (קופונים, פיקדון, שקיות נשיאה, תווי קנייה) — לא מייצאים
    await db.run(`CREATE OR REPLACE TEMP TABLE junk AS SELECT barcode FROM exp_products
      WHERE regexp_matches(search_key, '^(קופון|פיקדון|פקדון|שקית נשיאה|שקיות נשיאה|שקית קניות|דמי משלוח|כרטיס מתנה|תו קנייה|תו קניה|תו שי|גיפט קארד)')`);
    await db.run(`DELETE FROM exp_prices WHERE barcode IN (SELECT barcode FROM junk)`);
    await db.run(`DELETE FROM exp_products WHERE barcode IN (SELECT barcode FROM junk)`);
    // 2) איחוד כפילויות: פריטים עם קוד פנימי של רשת (chain:code — ירקות, מאפים, שקילים) שהם אותו פריט אצל כמה רשתות
    //    או בכמה קודים. מאחדים רק כשהשם המנורמל, הכמות, היחידה ו"שקיל" זהים לגמרי. מוצרים עם ברקוד אמיתי לא מאוחדים:
    //    ברקוד שונה = מוצר שונה (למשל טעמים שונים שהרשתות קיצרו לאותו שם).
    //    שקיל (ירקות/בשר במשקל) = מחיר לק"ג, ולכן המפתח הוא השם בלבד (היצרן בקודים פנימיים הוא לרוב ריק/"משתנה"/","),
    //    ולא-שקיל = שם + יצרן + כמות ביחידה מנורמלת (ק"ג/KG/קילוגרם → kg, 1000 גרם → 1 kg).
    //    קודים קצרים (עד 7 ספרות) של פריט שקיל הם קודי PLU של הרשת, כמו קוד פנימי.
    const unitSql = `CASE
        WHEN regexp_matches(lower(unit_qty), '^(ק"?ג|קג|קילו|קילוגרם|קילוגרמים|kg)$') THEN 'kg'
        WHEN regexp_matches(lower(unit_qty), '^(גרם|גר|ג|גרמים|g|gr)$') THEN 'g'
        WHEN regexp_matches(lower(unit_qty), '^(ליטר|ליטרים|ל|l|lt)$') THEN 'l'
        WHEN regexp_matches(lower(unit_qty), '^(מ"?ל|מיליליטר|ml)$') THEN 'ml'
        WHEN regexp_matches(unit_qty, '^(יחידה|יחידות|יח|יח'')$') THEN 'u'
        ELSE unit_qty END`;
    const qtySql = `CASE WHEN ${unitSql} IN ('g', 'ml') THEN quantity / 1000 ELSE quantity END`;
    await db.run(`CREATE OR REPLACE TEMP TABLE canon AS
      SELECT barcode, 'n:' || substr(md5(CASE WHEN is_weighted THEN ${SEARCH_KEY_SQL("coalesce(name, '')")} || '|w'
        ELSE search_key || '|' || coalesce(CAST(round(${qtySql}, 4) AS VARCHAR), '') || '|' || CASE ${unitSql} WHEN 'g' THEN 'kg' WHEN 'ml' THEN 'l' ELSE ${unitSql} END END), 1, 12) AS cid
      FROM exp_products
      WHERE (barcode LIKE '%:%' OR (is_weighted AND length(barcode) <= 7 AND regexp_matches(barcode, '^[0-9]+$')))
        AND length(search_key) >= 2`);
    await db.run(`CREATE OR REPLACE TEMP TABLE exp_prices AS
      SELECT coalesce(c.cid, p.barcode) AS barcode, p.chain_id, p.store_id, min(p.price_ag) AS price_ag, any_value(p.city_key) AS city_key
      FROM exp_prices p LEFT JOIN canon c USING (barcode) GROUP BY ALL`);
    await db.run(`CREATE OR REPLACE TEMP TABLE exp_products AS
      SELECT coalesce(c.cid, p.barcode) AS barcode, min(p.name) AS name, min(p.manufacturer) AS manufacturer, mode(p.quantity) AS quantity,
        mode(p.unit_qty) AS unit_qty, mode(p.uom) AS uom, any_value(p.is_weighted) AS is_weighted, any_value(p.search_key) AS search_key
      FROM exp_products p LEFT JOIN canon c USING (barcode) GROUP BY coalesce(c.cid, p.barcode)`);
    // 3) קטגוריה לכל מוצר: אותו כלל כמו באפליקציה (המילה המוקדמת בשם קובעת), כך ש"רוטב עגבניות" לא נכנס לירקות
    const catRows = await db.all<{ barcode: string; name: string; is_weighted: boolean; unit_qty: string; quantity: number | null }>(
      `SELECT barcode, name, is_weighted, unit_qty, quantity::DOUBLE AS quantity FROM exp_products`);
    const catFile = join(outDir, "_cats.csv").replace(/\\/g, "/");
    writeFileSync(catFile, "barcode,cat,sub\n" + catRows.map((r) => {
      const p = placeOf({ ...r, name: r.name ?? "" });
      return `"${r.barcode.replace(/"/g, '""')}",${p?.cat ?? ""},${p?.sub ?? ""}`;
    }).join("\n"));
    await db.run(`CREATE OR REPLACE TEMP TABLE exp_products AS SELECT p.*, coalesce(c.cat, '') AS cat, coalesce(c.sub, '') AS sub
      FROM exp_products p LEFT JOIN read_csv('${catFile}', header = true, columns = {'barcode': 'VARCHAR', 'cat': 'VARCHAR', 'sub': 'VARCHAR'}) c USING (barcode)`);
    rmSync(catFile);
    // 4) מבצעים תקפים היום, רק למוצר שיש לו מחיר מיוצא באותו סניף. לכל סניף+מוצר: המבצע הטוב לכל הלקוחות והמבצע הטוב למועדון.
    //    "1+1": המחיר ל-min_qty יחידות = המחיר הרגיל × היחידות שמשלמים עליהן.
    //    בדיקת שפיות מול המחיר הרגיל: מבצע שאינו זול יותר, או שזול ביותר מ-80% (שגיאת נתונים / מתנה), לא מיוצא.
    const now = opts.now ?? israelNow();
    await db.run(`CREATE OR REPLACE TEMP TABLE exp_promos AS
      WITH cand AS (
        SELECT coalesce(c.cid, pr.barcode) AS barcode, pr.chain_id, pr.store_id, pr.club, pr.min_qty,
          CASE pr.kind WHEN 'free' THEN CAST(round(p.price_ag * (pr.min_qty - pr.free_qty)) AS INTEGER) ELSE pr.total_ag END AS total_ag,
          pr.max_qty, pr.min_purchase_ag, pr.end_date, pr.descr, p.price_ag, p.city_key
        FROM promos pr
        LEFT JOIN canon c ON c.barcode = pr.barcode
        JOIN exp_prices p ON p.barcode = coalesce(c.cid, pr.barcode) AND p.chain_id = pr.chain_id AND p.store_id = pr.store_id
        WHERE (pr.start_at IS NULL OR pr.start_at <= CAST($now AS TIMESTAMP)) AND pr.end_date >= CAST($now AS DATE)
      ), ok AS (
        SELECT *, total_ag / min_qty AS unit FROM cand
        WHERE total_ag > 0 AND min_qty >= 1 AND total_ag / min_qty <= price_ag * 0.99 AND total_ag / min_qty >= price_ag * 0.2
          AND (max_qty IS NULL OR max_qty >= min_qty)
      )
      SELECT barcode, chain_id, store_id, club, min_qty, total_ag::INTEGER AS total_ag, max_qty, min_purchase_ag,
        strftime(end_date, '%Y-%m-%d') AS ends, descr, CAST(round(unit) AS INTEGER) AS unit_ag, city_key
      FROM (SELECT *, row_number() OVER (PARTITION BY barcode, chain_id, store_id, club
              ORDER BY unit, coalesce(min_purchase_ag, 0), min_qty, end_date DESC, descr) AS rn FROM ok)
      WHERE rn = 1`, { now });
    const merged = (await db.all<{ codes: number; groups: number }>(`SELECT count(*)::INTEGER AS codes, count(DISTINCT cid)::INTEGER AS groups FROM canon`))[0]!;
    log(`  merged ${merged.codes} chain-internal items into ${merged.groups}; removed ${(await db.all<{ n: number }>("SELECT count(*)::INTEGER AS n FROM junk"))[0]!.n} non-product items`);

    // עמודות המבצע של מוצר (לכרטיסי המוצרים): deal_ag = המחיר הנמוך ליחידה במבצע לכל הלקוחות בלי תנאי קנייה,
    // deal_qty / deal_total_ag = "deal_qty ב-deal_total_ag", club_ag = הנמוך במבצעי מועדון, n_deals = בכמה סניפים יש מבצע כלשהו
    const productSql = (where: string) => `
      SELECT x.*, d.deal_ag, d.deal_qty, d.deal_total_ag, d.club_ag, coalesce(d.n_deals, 0)::INTEGER AS n_deals
      FROM (
        SELECT pr.barcode, pr.name, pr.manufacturer, pr.quantity, pr.unit_qty, pr.uom, pr.is_weighted, pr.search_key, pr.cat, pr.sub,
          count(*)::INTEGER AS n_stores, count(DISTINCT p.chain_id)::INTEGER AS n_chains, min(p.price_ag)::INTEGER AS min_ag, max(p.price_ag)::INTEGER AS max_ag
        FROM exp_prices p JOIN exp_products pr USING (barcode)
        ${where}
        GROUP BY ALL) x
      LEFT JOIN (${dealAggSql(`FROM exp_promos p ${where}`, "unit_ag")}) d USING (barcode)
      ORDER BY x.barcode`;
    const promoSql = (where: string) => `
      SELECT barcode, chain_id, store_id, club, min_qty, total_ag, max_qty, min_purchase_ag, ends, descr FROM exp_promos ${where}
      ORDER BY barcode, chain_id, store_id, club`;
    const priceSql = (where: string) => `
      SELECT barcode, chain_id, store_id, price_ag::INTEGER AS price_ag FROM exp_prices ${where}
      ORDER BY barcode, chain_id, store_id`;
    const storeCols = `chain_id, store_id, chain_name, store_name, city, address, updated, stale`;

    const cities = await db.all<{ city_key: string; stores: number; chains: number }>(`
      SELECT city_key, count(*)::INTEGER AS stores, count(DISTINCT chain_id)::INTEGER AS chains
      FROM exp_stores WHERE (chain_id, store_id) IN (SELECT DISTINCT chain_id, store_id FROM exp_prices)
      GROUP BY city_key ORDER BY stores DESC, city_key`);

    // אזורים (לפי נפה, מרשימת היישובים הרשמית): ליישוב בלי סניפים מציגים את הסניפים בנפה שלו
    const locs = loadLocalities();
    const nafaOf = new Map<string, string>();
    for (const l of locs) if (l.nafa) nafaOf.set(normalizeCity(l.name), l.nafa);
    const cityKeys = new Set(cities.map((c) => c.city_key));
    const byNafa = new Map<string, string[]>();
    for (const c of cities) {
      const n = nafaOf.get(c.city_key);
      if (n) byNafa.set(n, [...(byNafa.get(n) ?? []), c.city_key]);
    }
    // נפות יהודה ושומרון נקראות בלמ"ס על שם ערים פלסטיניות; לתצוגה — השם המקובל של האזור
    const NAFA_NAME: Record<string, string> = { "ג'נין": "צפון השומרון", "שכם": "השומרון", "טול כרם": "מערב השומרון", "ראמאללה": "בנימין", "בית לחם": "גוש עציון", "חברון": "הר חברון", "ירדן )יריחו(": "בקעת הירדן" };
    const areaName = (nafa: string) => `אזור ${NAFA_NAME[nafa] ?? nafa}`;
    const scopes: { key: string; keys: string[] }[] = [
      ...cities.map((c) => ({ key: c.city_key, keys: [c.city_key] })),
      ...[...byNafa].filter(([, ks]) => ks.length > 1).map(([n, ks]) => ({ key: areaName(n), keys: ks })),
    ];
    const unmatched = cities.filter((c) => locs.length && !nafaOf.has(c.city_key)).map((c) => c.city_key);
    if (unmatched.length) log(`  cities not in the official list: ${unmatched.join(", ")}`);

    const entries: CityEntry[] = [];
    const areas: CityEntry[] = [];
    for (const sc of scopes) {
      const isArea = sc.keys.length > 1 || !cityKeys.has(sc.key);
      const c = isArea
        ? { city_key: sc.key, ...(await db.all<{ stores: number; chains: number }>(`SELECT count(*)::INTEGER AS stores, count(DISTINCT chain_id)::INTEGER AS chains
            FROM exp_stores WHERE city_key IN (${sc.keys.map(sqlString).join(",")}) AND (chain_id, store_id) IN (SELECT DISTINCT chain_id, store_id FROM exp_prices)`))[0]! }
        : cities.find((x) => x.city_key === sc.key)!;
      const slug = isArea ? "area-" + citySlug(sc.key) : citySlug(c.city_key);
      const dir = join("cities", slug);
      mkdirSync(join(outDir, dir), { recursive: true });
      const inList = `IN (${sc.keys.map(sqlString).join(",")})`;
      const where = `WHERE p.city_key ${inList}`;
      await parquet(priceSql(where.replace("p.city_key", "city_key")), join(dir, "prices.parquet"));
      await parquet(productSql(where), join(dir, "products.parquet"));
      await parquet(promoSql(where.replace("p.city_key", "city_key")), join(dir, "promos.parquet"));
      // היסטוריית מחירים (שורה לכל שינוי מחיר) של המחירים המיוצאים. נטען בדפדפן רק בדף מוצר.
      await parquet(`SELECT coalesce(c.cid, h.barcode) AS barcode, h.chain_id, h.store_id, h.price_ag::INTEGER AS price_ag,
          strftime(h.valid_from, '%Y-%m-%d %H:%M') AS since
        FROM price_history h LEFT JOIN canon c USING (barcode)
        JOIN exp_prices p ON p.barcode = coalesce(c.cid, h.barcode) AND p.chain_id = h.chain_id AND p.store_id = h.store_id
        WHERE p.city_key ${inList} AND h.price_ag > 0
        ORDER BY h.barcode, h.chain_id, h.store_id, h.valid_from`, join(dir, "history.parquet"));
      const stores = await db.all(`SELECT ${storeCols} FROM exp_stores WHERE city_key ${inList}
        AND (chain_id, store_id) IN (SELECT DISTINCT chain_id, store_id FROM exp_prices) ORDER BY city, chain_name, store_name`);
      json(join(dir, "stores.json"), stores);
      (isArea ? areas : entries).push({ key: c.city_key, name: c.city_key, slug, stores: c.stores, chains: c.chains, ...(isArea ? { cities: sc.keys } : {}) });
      log(`  ${c.city_key}: ${c.stores} stores`);
    }
    // יישובים בלי סניפים → האזור שלהם (שם, slug של האזור)
    const areaSlugOf = new Map(areas.map((a) => [a.key, a.slug]));
    const seenLoc = new Set<string>();
    const localities: { n: string; a: string }[] = [];
    for (const l of locs) {
      const k = normalizeCity(l.name);
      if (!k || cityKeys.has(k) || seenLoc.has(k) || !l.nafa) continue;
      const a = areaSlugOf.get(areaName(l.nafa)) ?? (byNafa.get(l.nafa)?.length === 1 ? citySlug(byNafa.get(l.nafa)![0]!) : undefined);
      if (!a) continue;
      seenLoc.add(k);
      localities.push({ n: k, a });
    }

    await parquet(priceSql(""), join("all", "prices.parquet"));
    await parquet(productSql(""), join("all", "products.parquet"));
    await parquet(promoSql(""), join("all", "promos.parquet"));
    const allStores = await db.all(`SELECT ${storeCols} FROM exp_stores
      WHERE (chain_id, store_id) IN (SELECT DISTINCT chain_id, store_id FROM exp_prices) ORDER BY city, chain_name, store_name`);
    json(join("all", "stores.json"), allStores);

    const chains = await db.all<{ id: string; name: string; stores: number }>(`
      SELECT chain_id AS id, any_value(chain_name) AS name, count(*)::INTEGER AS stores FROM exp_stores GROUP BY chain_id ORDER BY stores DESC`);
    const totals = (await db.all<{ stores: number; products: number; prices: number; promos: number }>(`
      SELECT (SELECT count(*) FROM exp_stores)::INTEGER AS stores,
             (SELECT count(*) FROM exp_products)::INTEGER AS products,
             (SELECT count(*) FROM exp_prices)::INTEGER AS prices,
             (SELECT count(*) FROM exp_promos)::INTEGER AS promos`))[0]!;
    log(`  promos: ${totals.promos} store×product deals`);
    const upd = (await db.all<{ t: string | null }>(`SELECT strftime(max(last_seen), '%Y-%m-%d %H:%M') AS t FROM current_prices`))[0]?.t ?? null;
    const testData = (await db.getMeta("test_data")) === "true";
    const index: SiteIndex = {
      version: 1,
      generatedAt: new Date().toISOString(),
      dataUpdatedAt: upd,
      testData,
      chains,
      cities: entries,
      areas,
      localities,
      totals,
      files,
    };
    writeFileSync(join(outDir, "index.json"), JSON.stringify(index));
    return index;
  } finally {
    await db.close();
  }
}
