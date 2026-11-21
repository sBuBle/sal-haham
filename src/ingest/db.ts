/**
 * שכבת DuckDB: סכמה, טעינת קובץ בודד (stream → appender ל-TEMP staging → merge),
 * היסטוריית מחירים (שורה חדשה רק כשהמחיר משתנה) ודילוג על קבצים שכבר נטענו לפי sha256.
 */
import { DuckDBInstance, type DuckDBConnection, type DuckDBAppender } from "@duckdb/node-api";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { availableParallelism, totalmem } from "node:os";
import { openText } from "./decode.ts";
import { parseRecords, type Fields } from "./parser.ts";
import { parseFileName, normId, type ParsedFileName } from "./filename.ts";
import { toItem, toStore } from "./records.ts";
import { parsePromos, promoRows } from "./promo.ts";
import type { CityCodeMap } from "../shared/city.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key VARCHAR PRIMARY KEY, value VARCHAR);
CREATE TABLE IF NOT EXISTS chains(chain_id VARCHAR PRIMARY KEY, chain_name VARCHAR);
CREATE TABLE IF NOT EXISTS stores(
  chain_id VARCHAR, store_id VARCHAR, sub_chain_id VARCHAR,
  chain_name VARCHAR, store_name VARCHAR, city VARCHAR, city_key VARCHAR, address VARCHAR,
  updated_at TIMESTAMP,
  PRIMARY KEY(chain_id, store_id));
CREATE TABLE IF NOT EXISTS products(
  barcode VARCHAR PRIMARY KEY, name VARCHAR, manufacturer VARCHAR,
  unit_qty VARCHAR, quantity DOUBLE, uom VARCHAR, is_weighted BOOLEAN,
  updated_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS current_prices(
  chain_id VARCHAR, store_id VARCHAR, barcode VARCHAR,
  price_ag INTEGER, valid_from TIMESTAMP, last_seen TIMESTAMP,
  PRIMARY KEY(chain_id, store_id, barcode));
CREATE TABLE IF NOT EXISTS price_history(
  chain_id VARCHAR, store_id VARCHAR, barcode VARCHAR, price_ag INTEGER, valid_from TIMESTAMP);
CREATE TABLE IF NOT EXISTS promos(
  chain_id VARCHAR, store_id VARCHAR, promo_id VARCHAR, barcode VARCHAR,
  descr VARCHAR, start_at TIMESTAMP, end_date DATE, club BOOLEAN,
  kind VARCHAR, min_qty DOUBLE, total_ag INTEGER, free_qty DOUBLE, max_qty DOUBLE, min_purchase_ag INTEGER,
  file_ts TIMESTAMP);
CREATE TABLE IF NOT EXISTS loaded_files(
  sha256 VARCHAR PRIMARY KEY, file_name VARCHAR, kind VARCHAR, chain_id VARCHAR, store_id VARCHAR,
  file_ts TIMESTAMP, rows INTEGER, parse_errors INTEGER, loaded_at TIMESTAMP);
`;

/** ברירות מחדל לפי המחשב: עד 8 ליבות (משאירים 2 פנויות) ועד 4GB (כשליש מהזיכרון). בייצוא של כל הארץ זה פי 3-4 מהר יותר
 *  מ-2 ליבות / 1GB. אפשר לקבוע במפורש עם DUCKDB_THREADS / DUCKDB_MEMORY_LIMIT. */
export const DEFAULT_THREADS = Math.max(2, Math.min(8, availableParallelism() - 2));
export const DEFAULT_MEMORY = `${Math.max(1, Math.min(4, Math.floor((totalmem() / 2 ** 30) * 0.35)))}GB`;

export interface IngestResult {
  file: string;
  status: "loaded" | "skipped-duplicate" | "skipped-kind" | "skipped-name" | "error";
  kind?: string;
  rows?: number;
  parseErrors?: number;
  newHistory?: number;
  encoding?: string;
  compression?: string;
  message?: string;
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const c of createReadStream(path, { highWaterMark: 1 << 20 })) h.update(c as Buffer);
  return h.digest("hex");
}

export class PriceDb {
  private constructor(readonly inst: DuckDBInstance, readonly con: DuckDBConnection) {}

  static async open(path = ":memory:", opts: { memoryLimit?: string; threads?: number } = {}): Promise<PriceDb> {
    const inst = await DuckDBInstance.create(path, {
      memory_limit: opts.memoryLimit ?? process.env.DUCKDB_MEMORY_LIMIT ?? DEFAULT_MEMORY,
      threads: String(opts.threads ?? process.env.DUCKDB_THREADS ?? DEFAULT_THREADS),
      preserve_insertion_order: "false",
    });
    const con = await inst.connect();
    const db = new PriceDb(inst, con);
    await con.run(SCHEMA);
    return db;
  }

  async all<T = Record<string, unknown>>(sql: string, params?: Record<string, any> | any[]): Promise<T[]> {
    const r = await this.con.runAndReadAll(sql, params as any);
    return r.getRowObjectsJson() as T[];
  }

  async run(sql: string, params?: Record<string, any> | any[]) {
    await this.con.run(sql, params as any);
  }

  async setMeta(key: string, value: string) {
    await this.run("INSERT OR REPLACE INTO meta VALUES ($k, $v)", { k: key, v: value });
  }

  async getMeta(key: string): Promise<string | null> {
    const r = await this.all<{ value: string }>("SELECT value FROM meta WHERE key = $k", { k: key });
    return r[0]?.value ?? null;
  }

  async isLoaded(sha: string): Promise<boolean> {
    const r = await this.all("SELECT 1 FROM loaded_files WHERE sha256 = $s", { s: sha });
    return r.length > 0;
  }

  async ingestFile(path: string, opts: { cityCodes?: CityCodeMap; displayName?: string } = {}): Promise<IngestResult> {
    const file = opts.displayName ?? basename(path);
    const meta = parseFileName(file);
    if (!meta) return { file, status: "skipped-name", message: "שם קובץ לא מזוהה" };
    const sha = await sha256File(path);
    if (await this.isLoaded(sha)) return { file, status: "skipped-duplicate", kind: meta.kind };
    try {
      if (meta.kind === "Stores") return await this.ingestStores(path, file, sha, meta, opts.cityCodes);
      if (meta.kind === "Promo" || meta.kind === "PromoFull") return await this.ingestPromos(path, file, sha, meta);
      return await this.ingestPrices(path, file, sha, meta);
    } catch (e) {
      try { await this.run("ROLLBACK"); } catch {}
      this.batch = false; // שגיאה באמצע אצווה מבטלת את כל האצווה; הקורא טוען את הקבצים שלה מחדש אחד-אחד
      return { file, status: "error", kind: meta.kind, message: String((e as Error)?.message ?? e).slice(0, 300) };
    }
  }

  // ---- אצווה: כמה קבצים בטרנזקציה אחת (COMMIT אחד במקום אחד לכל קובץ — כ-20% מזמן הטעינה של קובץ)
  private batch = false;
  get inBatch() { return this.batch; }
  async beginBatch() {
    await this.run("BEGIN TRANSACTION");
    this.batch = true;
  }
  /** false = האצווה כבר בוטלה (שגיאה באחד הקבצים) */
  async commitBatch(): Promise<boolean> {
    if (!this.batch) return false;
    this.batch = false;
    await this.run("COMMIT");
    return true;
  }
  private async begin() { if (!this.batch) await this.run("BEGIN TRANSACTION"); }
  private async commit() { if (!this.batch) await this.run("COMMIT"); }

  private async appender(table: string): Promise<DuckDBAppender> {
    return this.con.createAppender(table, "main", "temp");
  }

  private async ingestPrices(path: string, file: string, sha: string, meta: ParsedFileName): Promise<IngestResult> {
    await this.run(`CREATE OR REPLACE TEMP TABLE stg_items(
      barcode VARCHAR, name VARCHAR, manufacturer VARCHAR, quantity DOUBLE, unit_qty VARCHAR,
      uom VARCHAR, is_weighted BOOLEAN, price_ag INTEGER, valid_from VARCHAR)`);
    const ap = await this.appender("stg_items");
    const opened = await openText(path);
    let rows = 0;
    let testData = false;
    const { ctx, stats } = await parseRecords(
      opened.chunks,
      (kind, rec, c) => {
        if (kind !== "item") return;
        const chain = c["chainid"] || meta.chainId;
        const it = toItem(rec, chain, meta.timestamp);
        if (!it) return;
        ap.appendVarchar(it.barcode);
        ap.appendVarchar(it.name);
        ap.appendVarchar(it.manufacturer);
        if (it.quantity == null) ap.appendNull(); else ap.appendDouble(it.quantity);
        ap.appendVarchar(it.unit_qty);
        ap.appendVarchar(it.uom);
        ap.appendBoolean(it.is_weighted);
        ap.appendInteger(it.price_ag);
        ap.appendVarchar(it.valid_from);
        ap.endRow();
        rows++;
      },
      undefined,
      ["item"],
    );
    ap.flushSync();
    ap.closeSync();
    if (ctx["testdata"] === "true") testData = true;

    const chainId = ctx["chainid"] || meta.chainId;
    const storeId = normId(meta.storeId) ?? normId(ctx["storeid"]);
    if (!storeId) throw new Error("לא נמצא StoreId בקובץ או בשם");
    const p = { chain: chainId, store: storeId, ts: meta.timestamp };

    await this.begin();
    // כפילויות בתוך אותו קובץ: לוקחים את השורה עם עדכון המחיר המאוחר
    await this.run(`CREATE OR REPLACE TEMP TABLE stg AS
      SELECT barcode,
        arg_max(name, valid_from) AS name, arg_max(manufacturer, valid_from) AS manufacturer,
        arg_max(quantity, valid_from) AS quantity, arg_max(unit_qty, valid_from) AS unit_qty,
        arg_max(uom, valid_from) AS uom, bool_or(is_weighted) AS is_weighted,
        arg_max(price_ag, valid_from) AS price_ag,
        least(max(TRY_CAST(valid_from AS TIMESTAMP)), CAST($ts AS TIMESTAMP) + INTERVAL 1 DAY) AS valid_from
      FROM stg_items GROUP BY barcode`, { ts: p.ts });
    // מוצר נשמר פעם אחת; שדות ריקים לא דורסים מידע קיים
    await this.run(`INSERT INTO products
      SELECT barcode, name, manufacturer, unit_qty, quantity, uom, is_weighted, CAST($ts AS TIMESTAMP) FROM stg
      ON CONFLICT (barcode) DO UPDATE SET
        name = CASE WHEN excluded.name <> '' AND excluded.updated_at >= products.updated_at THEN excluded.name ELSE products.name END,
        manufacturer = CASE WHEN excluded.manufacturer <> '' AND excluded.updated_at >= products.updated_at THEN excluded.manufacturer ELSE products.manufacturer END,
        unit_qty = coalesce(nullif(excluded.unit_qty, ''), products.unit_qty),
        quantity = coalesce(excluded.quantity, products.quantity),
        uom = coalesce(nullif(excluded.uom, ''), products.uom),
        is_weighted = excluded.is_weighted OR products.is_weighted,
        updated_at = greatest(excluded.updated_at, products.updated_at)`, { ts: p.ts });
    await this.run(`CREATE OR REPLACE TEMP TABLE stg_join AS
      SELECT s.barcode, s.price_ag, coalesce(s.valid_from, CAST($ts AS TIMESTAMP)) AS new_vf,
        c.price_ag AS old_price, c.valid_from AS old_vf, c.last_seen AS old_seen,
        (c.last_seen IS NULL OR CAST($ts AS TIMESTAMP) >= c.last_seen) AS newer
      FROM stg s LEFT JOIN current_prices c
        ON c.chain_id = $chain AND c.store_id = $store AND c.barcode = s.barcode`, p);
    // valid_from של שינוי: תאריך העדכון מהקובץ אם הוא אחרי הקודם, אחרת זמן הקובץ
    const vf = `CASE WHEN old_vf IS NULL OR new_vf > old_vf THEN new_vf ELSE CAST($ts AS TIMESTAMP) END`;
    const hist = await this.all<{ n: number }>(`SELECT count(*)::INT AS n FROM stg_join
      WHERE newer AND (old_price IS NULL OR old_price <> price_ag)`);
    await this.run(`INSERT INTO price_history
      SELECT $chain, $store, barcode, price_ag, ${vf} FROM stg_join
      WHERE newer AND (old_price IS NULL OR old_price <> price_ag)`, p);
    await this.run(`INSERT OR REPLACE INTO current_prices
      SELECT $chain, $store, barcode,
        CASE WHEN newer THEN price_ag ELSE old_price END,
        CASE WHEN NOT newer THEN old_vf
             WHEN old_price IS NULL OR old_price <> price_ag THEN ${vf}
             ELSE old_vf END,
        CASE WHEN newer THEN CAST($ts AS TIMESTAMP) ELSE old_seen END
      FROM stg_join`, p);
    await this.run(`INSERT OR IGNORE INTO chains VALUES ($chain, NULL)`, { chain: chainId });
    await this.run(`INSERT INTO loaded_files VALUES ($sha, $file, $kind, $chain, $store, CAST($ts AS TIMESTAMP), $rows, $errs, now())`, {
      sha, file, kind: meta.kind, chain: chainId, store: storeId, ts: p.ts, rows, errs: stats.errors,
    });
    if (testData) await this.run(`INSERT OR REPLACE INTO meta VALUES ('test_data', 'true')`);
    await this.commit();
    await this.run("DROP TABLE IF EXISTS stg_items; DROP TABLE IF EXISTS stg; DROP TABLE IF EXISTS stg_join;");
    return {
      file, status: "loaded", kind: meta.kind, rows, parseErrors: stats.errors, newHistory: hist[0]?.n ?? 0,
      encoding: opened.encoding, compression: opened.compression,
      message: stats.firstError ?? undefined,
    };
  }

  /**
   * מבצעים. PromoFull מחליף את כל מבצעי הסניף; Promo (עדכון) מחליף רק את המבצעים שמופיעים בו.
   * קובץ ישן שמגיע אחרי חדש לא דורס.
   */
  private async ingestPromos(path: string, file: string, sha: string, meta: ParsedFileName): Promise<IngestResult> {
    await this.run(`CREATE OR REPLACE TEMP TABLE stg_promos(
      promo_id VARCHAR, barcode VARCHAR, descr VARCHAR, start_at VARCHAR, end_date VARCHAR, club BOOLEAN,
      kind VARCHAR, min_qty DOUBLE, total_ag INTEGER, free_qty DOUBLE, max_qty DOUBLE, min_purchase_ag INTEGER)`);
    await this.run(`CREATE OR REPLACE TEMP TABLE stg_promo_ids(promo_id VARCHAR)`);
    const ap = await this.appender("stg_promos");
    const ids = await this.appender("stg_promo_ids");
    const opened = await openText(path);
    let rows = 0;
    let chainId = meta.chainId;
    const { ctx, stats } = await parsePromos(opened.chunks, (p, c) => {
      chainId = c["chainid"] || meta.chainId;
      const id = (p.fields["promotionid"] ?? "").trim();
      if (id) { ids.appendVarchar(id); ids.endRow(); }
      for (const r of promoRows(p, chainId)) {
        ap.appendVarchar(r.promo_id);
        ap.appendVarchar(r.barcode);
        ap.appendVarchar(r.descr.slice(0, 200));
        if (r.start_at) ap.appendVarchar(r.start_at); else ap.appendNull();
        if (r.end_date) ap.appendVarchar(r.end_date); else ap.appendNull();
        ap.appendBoolean(r.club);
        ap.appendVarchar(r.kind);
        ap.appendDouble(r.min_qty);
        ap.appendInteger(r.total_ag);
        ap.appendDouble(r.free_qty);
        if (r.max_qty == null) ap.appendNull(); else ap.appendDouble(r.max_qty);
        if (r.min_purchase_ag == null) ap.appendNull(); else ap.appendInteger(r.min_purchase_ag);
        ap.endRow();
        rows++;
      }
    });
    ap.flushSync(); ap.closeSync();
    ids.flushSync(); ids.closeSync();
    chainId = ctx["chainid"] || chainId;
    const storeId = normId(meta.storeId) ?? normId(ctx["storeid"]);
    if (!storeId) throw new Error("לא נמצא StoreId בקובץ או בשם");
    const p = { chain: chainId, store: storeId, ts: meta.timestamp };
    const newer = `(SELECT max(file_ts) FROM loaded_files WHERE chain_id = $chain AND store_id = $store AND kind = 'PromoFull') `;
    await this.begin();
    const stale = (await this.all<{ stale: boolean }>(`SELECT coalesce(${newer} > CAST($ts AS TIMESTAMP), false) AS stale`, p))[0]?.stale === true;
    if (!stale) {
      if (meta.kind === "PromoFull") await this.run(`DELETE FROM promos WHERE chain_id = $chain AND store_id = $store`, { chain: chainId, store: storeId });
      else await this.run(`DELETE FROM promos WHERE chain_id = $chain AND store_id = $store AND promo_id IN (SELECT promo_id FROM stg_promo_ids)`, { chain: chainId, store: storeId });
      await this.run(`INSERT INTO promos
        SELECT $chain, $store, promo_id, barcode, any_value(descr), TRY_CAST(any_value(start_at) AS TIMESTAMP), TRY_CAST(any_value(end_date) AS DATE),
          any_value(club), any_value(kind), any_value(min_qty), any_value(total_ag), any_value(free_qty), any_value(max_qty), any_value(min_purchase_ag),
          CAST($ts AS TIMESTAMP)
        FROM stg_promos GROUP BY promo_id, barcode`, p);
    }
    await this.run(`INSERT INTO loaded_files VALUES ($sha, $file, $kind, $chain, $store, CAST($ts AS TIMESTAMP), $rows, $errs, now())`, {
      sha, file, kind: meta.kind, chain: chainId, store: storeId, ts: p.ts, rows, errs: stats.errors,
    });
    if (ctx["testdata"] === "true") await this.run(`INSERT OR REPLACE INTO meta VALUES ('test_data', 'true')`);
    await this.commit();
    await this.run("DROP TABLE IF EXISTS stg_promos; DROP TABLE IF EXISTS stg_promo_ids;");
    return {
      file, status: "loaded", kind: meta.kind, rows, parseErrors: stats.errors,
      encoding: opened.encoding, compression: opened.compression,
      message: stale ? "קובץ מבצעים ישן מהקיים — לא דרס" : stats.firstError ?? undefined,
    };
  }

  private async ingestStores(path: string, file: string, sha: string, meta: ParsedFileName, codes?: CityCodeMap): Promise<IngestResult> {
    await this.run(`CREATE OR REPLACE TEMP TABLE stg_stores(
      chain_id VARCHAR, store_id VARCHAR, sub_chain_id VARCHAR, chain_name VARCHAR, store_name VARCHAR,
      city VARCHAR, city_key VARCHAR, address VARCHAR)`);
    const ap = await this.appender("stg_stores");
    const opened = await openText(path);
    let rows = 0;
    const { ctx, stats } = await parseRecords(
      opened.chunks,
      (kind, rec, c: Fields) => {
        if (kind !== "store") return;
        const s = toStore(rec, c, meta.chainId, codes);
        if (!s) return;
        for (const v of [s.chain_id, s.store_id, s.sub_chain_id, s.chain_name, s.store_name, s.city, s.city_key, s.address]) ap.appendVarchar(v);
        ap.endRow();
        rows++;
      },
      undefined,
      ["store"],
    );
    ap.flushSync();
    ap.closeSync();
    const chainName = ctx["chainname"] ?? "";
    await this.begin();
    await this.run(`INSERT OR REPLACE INTO stores
      SELECT chain_id, store_id, any_value(sub_chain_id),
        coalesce(nullif(any_value(chain_name), ''), $cn), any_value(store_name),
        any_value(city), any_value(city_key), any_value(address), CAST($ts AS TIMESTAMP)
      FROM stg_stores GROUP BY chain_id, store_id`, { cn: chainName, ts: meta.timestamp });
    await this.run(`INSERT OR REPLACE INTO chains
      SELECT chain_id, coalesce(nullif(any_value(chain_name), ''), $cn) FROM stg_stores GROUP BY chain_id`, { cn: chainName });
    await this.run(`INSERT INTO loaded_files VALUES ($sha, $file, 'Stores', $chain, NULL, CAST($ts AS TIMESTAMP), $rows, $errs, now())`, {
      sha, file, chain: meta.chainId, ts: meta.timestamp, rows, errs: stats.errors,
    });
    if (ctx["testdata"] === "true") await this.run(`INSERT OR REPLACE INTO meta VALUES ('test_data', 'true')`);
    await this.commit();
    await this.run("DROP TABLE IF EXISTS stg_stores");
    return {
      file, status: "loaded", kind: "Stores", rows, parseErrors: stats.errors,
      encoding: opened.encoding, compression: opened.compression, message: stats.firstError ?? undefined,
    };
  }

  async close() {
    try { this.con.closeSync(); } catch {}
    try { this.inst.closeSync(); } catch {}
  }
}
