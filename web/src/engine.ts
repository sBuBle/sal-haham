/**
 * מנוע השאילתות בדפדפן: DuckDB-WASM. נטען בעצלתיים (dynamic import) אחרי המסך הראשון.
 *
 * עיר: קובצי ה-Parquet של העיר מורדים במלואם (קטנים, ונשמרים ב-Cache לשימוש offline)
 *      ונרשמים כ-buffer.
 * כל הארץ: ה-Parquet הגדול נקרא ב-HTTP Range (registerFileURL), בלי להוריד את כולו.
 *
 * אירוח עצמי: ה-wasm וה-worker נארזים עם האתר (Vite ?url). אפשר לטעון אותם מ-jsDelivr
 * עם VITE_DUCKDB_CDN=jsdelivr. את ה-extensions (parquet) DuckDB-WASM טוען מ-extensions.duckdb.org;
 * עם VITE_DUCKDB_EXT_REPO אפשר להפנות למאגר מקומי (ראו scripts/selfhost-duckdb.ts).
 */
import type * as DuckDB from "@duckdb/duckdb-wasm";
import { parseQuery, sqlString } from "../../src/shared/search.ts";
import { normBarcode } from "../../src/shared/barcode.ts";
import type { PriceRow } from "../../src/shared/ranking.ts";
import { DEAL_COLS, dealAggSql, todayIso, type PromoRow } from "../../src/shared/promo.ts";
import { categoryWhere, type Category } from "../../src/shared/categories.ts";
import { fetchBuffer, dataUrl } from "./data.ts";

export interface Product {
  barcode: string;
  /** תת-המחלקה שחושבה בבניית הנתונים (אם יש) */
  sub?: string;
  name: string;
  manufacturer: string;
  quantity: number | null;
  unit_qty: string;
  uom: string;
  is_weighted: boolean;
  n_stores: number;
  min_ag: number;
  max_ag: number;
  /** מבצעים (מהייצוא; בנתונים ישנים חסר): המחיר הנמוך ליחידה במבצע לכל הלקוחות, "deal_qty ב-deal_total_ag", הנמוך במועדון, בכמה סניפים */
  deal_ag?: number | null;
  deal_qty?: number | null;
  deal_total_ag?: number | null;
  club_ag?: number | null;
  n_deals?: number | null;
}

export type Scope = { kind: "city"; slug: string } | { kind: "all" };

let dbPromise: Promise<{ db: DuckDB.AsyncDuckDB; conn: DuckDB.AsyncDuckDBConnection; duckdb: typeof DuckDB }> | null = null;

export function warmup() {
  return getDb();
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const t0 = performance.now();
      const duckdb = await import("@duckdb/duckdb-wasm");
      let bundle: DuckDB.DuckDBBundle;
      if (import.meta.env.VITE_DUCKDB_CDN === "jsdelivr") {
        bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      } else {
        const [mvpWasm, mvpWorker, ehWasm, ehWorker] = await Promise.all([
          import("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url"),
          import("@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url"),
          import("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url"),
          import("@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url"),
        ]);
        bundle = await duckdb.selectBundle({
          mvp: { mainModule: mvpWasm.default, mainWorker: mvpWorker.default },
          eh: { mainModule: ehWasm.default, mainWorker: ehWorker.default },
        });
      }
      // worker חוצה-מקור (CDN) צריך עטיפה של blob
      const workerUrl = /^https?:/.test(bundle.mainWorker!) && !bundle.mainWorker!.startsWith(location.origin)
        ? URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }))
        : bundle.mainWorker!;
      const worker = new Worker(workerUrl);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      await db.open({ query: { castBigIntToDouble: true } });
      const conn = await db.connect();
      const repo = import.meta.env.VITE_DUCKDB_EXT_REPO as string | undefined;
      if (repo) {
        const abs = new URL(repo, location.origin + import.meta.env.BASE_URL).href.replace(/\/$/, "");
        await conn.query(`SET custom_extension_repository = ${sqlString(abs)}`);
      }
      (window as any).__engineReadyMs = Math.round(performance.now() - t0);
      // ה-wasm וה-worker נטענים מתוך ה-worker, ולכן לא מופיעים ב-performance של הדף: מוסרים אותם במפורש לשמירה offline
      (window as any).__duckdbFiles = [bundle.mainModule, bundle.mainWorker].filter(Boolean).map((u) => new URL(u!, location.href).href);
      return { db, conn, duckdb };
    })();
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

let loadedScope = "";
let scopeLoading: Promise<void> | null = null;
let loadedIsCity = false;

// ---------------------------------------------------------------- סינון לרשת אחת
// products / prices הם תמיד מה שהאתר קורא. בלי סינון: הנתונים המלאים. עם רשת: רק המחירים שלה,
// ו-n_stores / min_ag / max_ag מחושבים מחדש מהסניפים של הרשת (מוצר שהרשת לא מוכרת לא מופיע).
let chainFilter: string | null = null;
let appliedChain: string | null | undefined;
let chainQueue: Promise<void> = Promise.resolve();

export function setChain(chain: string | null): Promise<void> {
  chainFilter = chain;
  const run = chainQueue.then(() => (loadedScope ? applyChain() : undefined));
  chainQueue = run.catch(() => {});
  return run; // שגיאה מגיעה לממשק (מצב "error") ולא נבלעת
}

/** DROP VIEW על טבלה (או להפך) נכשל גם עם IF EXISTS, אז בודקים מה קיים */
async function dropAny(conn: DuckDB.AsyncDuckDBConnection, ...names: string[]) {
  const existing = (await conn.query(`SELECT table_name, table_type FROM information_schema.tables
    WHERE table_name IN (${names.map(sqlString).join(",")})`)).toArray()
    .map((r: any) => ({ name: String(r.table_name), view: String(r.table_type) === "VIEW" }));
  for (const e of existing) await conn.query(`DROP ${e.view ? "VIEW" : "TABLE"} ${e.name}`);
}

async function applyChain() {
  if (appliedChain === chainFilter) return;
  const { conn } = await getDb();
  const ch = chainFilter;
  // בעיר: טבלאות (מהיר בכל שאילתה). בכל הארץ: views שקוראים רק מה שצריך מה-Parquet המרוחק.
  const kind = loadedIsCity && ch ? "TABLE" : "VIEW";
  await dropAny(conn, "products", "prices", "promos");
  // מבצעים: רק מה שעדיין בתוקף היום (הנתונים סטטיים בין עדכונים), ועם סינון רשת — רק שלה
  await conn.query(`CREATE VIEW promos AS SELECT * FROM promos_base WHERE ends >= ${sqlString(todayIso())}${ch ? ` AND chain_id = ${sqlString(ch)}` : ""}`);
  // n_chains (בכמה רשתות המוצר נמכר) קובע את סדר החיפוש; בנתונים ישנים בלי העמודה — 1
  const baseCols = (await conn.query(`SELECT column_name FROM (DESCRIBE products_base)`)).toArray().map((r: any) => String(r.column_name));
  const hasDeals = baseCols.includes("deal_ag");
  const noDeals = ", NULL::INTEGER AS deal_ag, NULL::DOUBLE AS deal_qty, NULL::INTEGER AS deal_total_ag, NULL::INTEGER AS club_ag, 0 AS n_deals";
  const extra = (baseCols.includes("n_chains") ? "" : ", 1 AS n_chains") + (hasDeals ? "" : noDeals);
  if (!ch) {
    await conn.query(`CREATE VIEW products AS SELECT *${extra} FROM products_base`);
    await conn.query(`CREATE VIEW prices AS SELECT * FROM prices_base`);
  } else {
    await conn.query(`CREATE ${kind} prices AS SELECT * FROM prices_base WHERE chain_id = ${sqlString(ch)}`);
    // עמודות המבצע מחושבות מחדש ממבצעי הרשת שנבחרה
    await conn.query(`CREATE ${kind} products AS
      SELECT b.* ${hasDeals ? `EXCLUDE (${DEAL_COLS.join(", ")}) ` : ""}REPLACE (s.n_stores AS n_stores, s.min_ag AS min_ag, s.max_ag AS max_ag)${baseCols.includes("n_chains") ? "" : ", 1 AS n_chains"},
        d.deal_ag, d.deal_qty, d.deal_total_ag, d.club_ag, coalesce(d.n_deals, 0) AS n_deals
      FROM products_base b JOIN (
        SELECT barcode, count(*)::INTEGER AS n_stores, min(price_ag)::INTEGER AS min_ag, max(price_ag)::INTEGER AS max_ag
        FROM prices GROUP BY barcode) s USING (barcode)
      LEFT JOIN (${dealAggSql("FROM promos")}) d USING (barcode)`);
  }
  appliedChain = ch;
}

/** טוען את נתוני העיר (או כל הארץ) לטבלאות products / prices */
export async function loadScope(scope: Scope, version: string): Promise<void> {
  const id = scope.kind === "all" ? "all" : scope.slug;
  const key = `${id}@${version}`;
  if (loadedScope === key) return;
  if (scopeLoading && (scopeLoading as any).key === key) return scopeLoading;
  const p = (async () => {
    const { db, conn, duckdb } = await getDb();
    if (scope.kind === "city") {
      const [products, prices, promos] = await Promise.all([
        fetchBuffer(dataUrl(`cities/${scope.slug}/products.parquet`, version)),
        fetchBuffer(dataUrl(`cities/${scope.slug}/prices.parquet`, version)),
        // נתונים ישנים בלי קובץ מבצעים: האתר עובד כרגיל, בלי מבצעים
        fetchBuffer(dataUrl(`cities/${scope.slug}/promos.parquet`, version)).catch(() => null),
      ]);
      await db.registerFileBuffer(`${id}_products.parquet`, new Uint8Array(products));
      await db.registerFileBuffer(`${id}_prices.parquet`, new Uint8Array(prices));
      await dropAny(conn, "products", "prices", "promos", "products_base", "prices_base", "promos_base");
      let hasPromos = false;
      if (promos) {
        try {
          await db.registerFileBuffer(`${id}_promos.parquet`, new Uint8Array(promos));
          await conn.query(`CREATE TABLE promos_base AS SELECT * FROM read_parquet('${id}_promos.parquet')`);
          hasPromos = true;
        } catch { /* קובץ לא תקין (למשל דף 404 של השרת) */ }
        await db.dropFile(`${id}_promos.parquet`).catch(() => {});
      }
      if (!hasPromos) await conn.query(EMPTY_PROMOS);
      await conn.query(`CREATE OR REPLACE TABLE products_base AS SELECT * FROM read_parquet('${id}_products.parquet')`);
      await conn.query(`CREATE OR REPLACE TABLE prices_base AS SELECT * FROM read_parquet('${id}_prices.parquet')`);
      // הזיכרון של ה-buffers משתחרר; הנתונים כבר בטבלאות
      await db.dropFile(`${id}_products.parquet`).catch(() => {});
      await db.dropFile(`${id}_prices.parquet`).catch(() => {});
    } else {
      const abs = (f: string) => new URL(dataUrl(`all/${f}`, version), location.href).href;
      await db.registerFileURL("all_products.parquet", abs("products.parquet"), duckdb.DuckDBDataProtocol.HTTP, false);
      await db.registerFileURL("all_prices.parquet", abs("prices.parquet"), duckdb.DuckDBDataProtocol.HTTP, false);
      await dropAny(conn, "products", "prices", "promos", "products_base", "prices_base", "promos_base");
      try {
        await db.registerFileURL("all_promos.parquet", abs("promos.parquet"), duckdb.DuckDBDataProtocol.HTTP, false);
        await conn.query(`CREATE VIEW promos_base AS SELECT * FROM read_parquet('all_promos.parquet')`);
      } catch {
        await dropAny(conn, "promos_base");
        await conn.query(EMPTY_PROMOS);
      }
      await conn.query(`CREATE OR REPLACE VIEW products_base AS SELECT * FROM read_parquet('all_products.parquet')`);
      await conn.query(`CREATE OR REPLACE VIEW prices_base AS SELECT * FROM read_parquet('all_prices.parquet')`);
    }
    loadedScope = key;
    loadedIsCity = scope.kind === "city";
    appliedChain = undefined;
    await applyChain();
  })();
  (p as any).key = key;
  scopeLoading = p;
  try {
    await p;
  } finally {
    if (scopeLoading === p) scopeLoading = null;
  }
}

const EMPTY_PROMOS = `CREATE TABLE promos_base(barcode VARCHAR, chain_id VARCHAR, store_id VARCHAR, club BOOLEAN, min_qty DOUBLE,
  total_ag INTEGER, max_qty DOUBLE, min_purchase_ag INTEGER, ends VARCHAR, descr VARCHAR)`;

async function rows<T>(sql: string): Promise<T[]> {
  const { conn } = await getDb();
  const t = await conn.query(sql);
  return t.toArray().map((r: any) => r.toJSON() as T);
}

const BASE_COLS = `barcode, name, manufacturer, quantity, unit_qty, uom, is_weighted, n_stores, min_ag, max_ag`;
const PRODUCT_COLS = `${BASE_COLS}, ${DEAL_COLS.join(", ")}`;

export async function search(q: string, limit = 30): Promise<Product[]> {
  const { barcode, tokens } = parseQuery(q);
  if (barcode) {
    const bc = normBarcode(barcode);
    return rows<Product>(`SELECT ${PRODUCT_COLS} FROM products
      WHERE barcode = ${sqlString(bc)} OR starts_with(barcode, ${sqlString(bc)})
      ORDER BY barcode = ${sqlString(bc)} DESC, n_stores DESC LIMIT ${limit}`);
  }
  if (!tokens.length) return [];
  const where = tokens.map((t) => `contains(search_key, ${sqlString(t)})`).join(" AND ");
  const first = sqlString(tokens[0]!);
  return rows<Product>(`SELECT ${PRODUCT_COLS} FROM products WHERE ${where}
    ORDER BY starts_with(search_key || ' ', ${sqlString(tokens.join(" ") + " ")}) DESC, starts_with(search_key, ${first}) DESC, n_chains DESC, n_stores DESC, length(name), name LIMIT ${limit}`);
}

/** מוצרים של קטגוריה (לפי מילות מפתח בשם), הנפוצים בסניפים קודם */
export async function browse(c: Category, limit = 24): Promise<Product[]> {
  // הייצוא מחשב את הקטגוריה לכל מוצר (עמודת cat, אותו כלל כמו categoryOf); נתונים ישנים בלי העמודה → מילות מפתח
  const { conn } = await getDb();
  const cols = (await conn.query(`SELECT column_name FROM (DESCRIBE products)`)).toArray().map((r: any) => String(r.column_name));
  // "other" = מוצרים שלא שויכו לאף מחלקה ("עוד מוצרים")
  const where = cols.includes("cat") ? `cat = ${sqlString(c.id === "other" ? "" : c.id)}` : c.id === "other" ? "false" : categoryWhere(c, sqlString);
  const extra = cols.includes("sub") ? ", sub" : "";
  return rows<Product>(`SELECT ${PRODUCT_COLS}${extra} FROM products WHERE ${where}
    ORDER BY n_chains DESC, n_stores DESC, length(name), name LIMIT ${limit}`);
}

/** כמה מוצרים יש בסך הכול לחיפוש / לקטגוריה (לכותרת "N מוצרים" ולכפתור "עוד") */
export async function countFor(q: string | null, c: Category | null): Promise<number> {
  let where = "";
  if (q) {
    const { barcode, tokens } = parseQuery(q);
    if (barcode) { const bc = normBarcode(barcode); where = `barcode = ${sqlString(bc)} OR starts_with(barcode, ${sqlString(bc)})`; }
    else if (tokens.length) where = tokens.map((t) => `contains(search_key, ${sqlString(t)})`).join(" AND ");
    else return 0;
  } else if (c) {
    const { conn } = await getDb();
    const cols = (await conn.query(`SELECT column_name FROM (DESCRIBE products)`)).toArray().map((r: any) => String(r.column_name));
    where = cols.includes("cat") ? `cat = ${sqlString(c.id === "other" ? "" : c.id)}` : categoryWhere(c, sqlString);
  } else return 0;
  return Number((await rows<{ n: number }>(`SELECT count(*) AS n FROM products WHERE ${where}`))[0]?.n ?? 0);
}

/** מצרכים בסיסיים: לכל סוג מוצר (חלב, לחם, ביצים...) המוצר שנמכר בהכי הרבה רשתות וסניפים.
 *  "הכי נפוצים" לפי מספר סניפים בלבד יוצא מסטיקים וחטיפים (רשתות הנוחות פרוסות בהרבה סניפים). */
const STAPLES = ["חלב", "לחם אחיד", "ביצים", "קוטג", "גבינה", "יוגורט", "חמאה", "שמן", "סוכר", "קמח", "אורז", "פסטה", "קפה", "עגבניות", "מלפפון", "בננה", "עוף", "טונה", "נייר טואלט", "נוזל כלים"];
export async function staples(limit = 12): Promise<Product[]> {
  const words = STAPLES.map(sqlString).join(",");
  return rows<Product>(`WITH s AS (SELECT unnest([${words}]) AS w, generate_subscripts([${words}], 1) AS i)
    SELECT ${PRODUCT_COLS}, n_chains FROM (
      SELECT p.*, s.i, row_number() OVER (PARTITION BY s.i ORDER BY p.n_chains * p.n_stores DESC, length(p.name)) AS rn
      FROM products p JOIN s ON starts_with(p.search_key, s.w || ' ')
    ) WHERE rn = 1 ORDER BY i LIMIT ${limit}`);
}

/** מועמדים לסל המוצרים בפיקוח: מוצרים שמתחילים במילה הראשונה של כל הגדרה (הסינון המדויק ב-basket.ts) */
export async function byFirstWords(words: string[], limit = 2000): Promise<Product[]> {
  if (!words.length) return [];
  return rows<Product>(`SELECT ${PRODUCT_COLS} FROM products WHERE ${words.map((w) => `starts_with(search_key, ${sqlString(w + " ")})`).join(" OR ")} ORDER BY n_stores DESC LIMIT ${limit}`);
}

/** המוצרים שנמכרים בהכי הרבה סניפים */
export async function popular(limit = 12): Promise<Product[]> {
  return rows<Product>(`SELECT ${PRODUCT_COLS} FROM products ORDER BY n_chains DESC, n_stores DESC, length(name), name LIMIT ${limit}`);
}

/** מחירי מוצר בכל הסניפים שנטענו */
export async function storePrices(barcode: string): Promise<PriceRow[]> {
  return rows<PriceRow>(`SELECT barcode, chain_id, store_id, price_ag FROM prices WHERE barcode = ${sqlString(barcode)} ORDER BY price_ag`);
}

export interface HistoryRow { chain_id: string; store_id: string; price_ag: number; since: string }
let historyLoaded = "";
/** היסטוריית מחירים של מוצר (רק לעיר; לכל הארץ לא מיוצא). נטען בפעם הראשונה שצריך. */
export async function history(barcode: string, scope: Scope, version: string): Promise<HistoryRow[] | null> {
  if (scope.kind !== "city") return null;
  const { db, conn } = await getDb();
  const key = `${scope.slug}@${version}`;
  if (historyLoaded !== key) {
    try {
      const buf = await fetchBuffer(dataUrl(`cities/${scope.slug}/history.parquet`, version));
      await db.registerFileBuffer(`${scope.slug}_history.parquet`, new Uint8Array(buf));
      await conn.query(`CREATE OR REPLACE TABLE history AS SELECT * FROM read_parquet('${scope.slug}_history.parquet')`);
      await db.dropFile(`${scope.slug}_history.parquet`).catch(() => {});
      historyLoaded = key;
    } catch {
      return null; // קובץ ישן בלי היסטוריה
    }
  }
  return rows<HistoryRow>(`SELECT chain_id, store_id, price_ag, since FROM history WHERE barcode = ${sqlString(barcode)}
    ${chainFilter ? `AND chain_id = ${sqlString(chainFilter)}` : ""} ORDER BY since`);
}

/** פריטי סל שהמזהה שלהם כבר לא קיים (מזהי n: של פריטים מאוחדים משתנים כשכללי האיחוד משתנים):
 *  מחפשים מוצר עם אותו שם בדיוק, אותו "שקיל", ואותה כמות ויחידה (ללא שקיל). מחזיר old → מוצר חדש. */
export async function resolveStale(items: { barcode: string; name: string; is_weighted: boolean; quantity: number | null; unit_qty: string }[]): Promise<Map<string, Product>> {
  const out = new Map<string, Product>();
  if (!items.length) return out;
  const have = new Set((await rows<{ barcode: string }>(`SELECT barcode FROM products_base WHERE barcode IN (${items.map((i) => sqlString(i.barcode)).join(",")})`)).map((r) => r.barcode));
  for (const it of items) {
    if (have.has(it.barcode) || !it.name) continue;
    const size = it.is_weighted ? "" : `AND quantity IS NOT DISTINCT FROM ${it.quantity ?? "NULL"} AND unit_qty = ${sqlString(it.unit_qty ?? "")}`;
    const r = await rows<Product>(`SELECT ${BASE_COLS} FROM products_base WHERE name = ${sqlString(it.name)} AND is_weighted = ${it.is_weighted ? "true" : "false"} ${size}
      ORDER BY starts_with(barcode, 'n:') DESC, n_stores DESC LIMIT 1`);
    if (r[0]) out.set(it.barcode, r[0]);
  }
  return out;
}

/** מספר המוצרים בנתונים הנוכחיים (אחרי סינון רשת) */
export async function countProducts(): Promise<number> {
  return Number((await rows<{ n: number }>(`SELECT count(*) AS n FROM products`))[0]?.n ?? 0);
}

/** מוצר בודד לפי ברקוד, עם מחיר מינ'/מקס' ומספר סניפים */
export async function product(barcode: string): Promise<Product | null> {
  const r = await rows<Product>(`SELECT ${PRODUCT_COLS} FROM products WHERE barcode = ${sqlString(barcode)} LIMIT 1`);
  return r[0] ?? null;
}

/** מועמדים לחלופה: מוצרים ששמם מתחיל באותה מילה ("חלב ..."). סינון יחידת מידה ומיון לפי מחיר ליחידה בממשק. */
export async function similar(typeWord: string, exclude: string, limit = 200): Promise<Product[]> {
  if (!typeWord) return [];
  return rows<Product>(`SELECT ${PRODUCT_COLS} FROM products
    WHERE starts_with(search_key, ${sqlString(typeWord + " ")}) AND barcode <> ${sqlString(exclude)}
    ORDER BY n_chains DESC, n_stores DESC LIMIT ${limit}`);
}

export async function lookup(code: string): Promise<Product | null> {
  const bc = normBarcode(code);
  if (!bc) return null;
  const r = await rows<Product>(`SELECT ${PRODUCT_COLS} FROM products WHERE barcode = ${sqlString(bc)} LIMIT 1`);
  return r[0] ?? null;
}

/** המבצעים התקפים של מוצרים, בכל הסניפים שנטענו (עד שניים לכל סניף+מוצר: לכל הלקוחות, ולמועדון) */
export async function promosFor(barcodes: string[]): Promise<PromoRow[]> {
  if (!barcodes.length) return [];
  const list = barcodes.map(sqlString).join(",");
  return rows<PromoRow>(`SELECT barcode, chain_id, store_id, club, min_qty, total_ag, max_qty, min_purchase_ag, ends, descr FROM promos WHERE barcode IN (${list})`);
}

export async function pricesFor(barcodes: string[]): Promise<PriceRow[]> {
  if (!barcodes.length) return [];
  const list = barcodes.map(sqlString).join(",");
  return rows<PriceRow>(`SELECT barcode, chain_id, store_id, price_ag FROM prices WHERE barcode IN (${list})`);
}
