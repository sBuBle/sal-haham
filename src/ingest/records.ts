/** מיפוי רשומות XML גולמיות (שדות באותיות קטנות) לשורות בסכמה */
import type { Fields } from "./parser.ts";
import { productKey } from "../shared/barcode.ts";
import { normId } from "./filename.ts";
import { buildCityMatcher, cleanText, normalizeCity, resolveCityName, type CityCodeMap } from "../shared/city.ts";

/** ערכי "מילוי" שהרשתות שמות במקום שדה ריק */
const PLACEHOLDER = /^(לא ידוע|לא מוגדר|לא רלוונטי|ללא|unknown|none|null|n\/a|-+|\.+)$/i;
export const orEmpty = (s: string) => (PLACEHOLDER.test(s.trim()) ? "" : s);

const pick = (r: Fields, ...keys: string[]): string => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== "" && !PLACEHOLDER.test(v)) return v;
  }
  return "";
};

export interface ItemRow {
  barcode: string;
  name: string;
  manufacturer: string;
  quantity: number | null;
  unit_qty: string;
  uom: string;
  is_weighted: boolean;
  price_ag: number;
  valid_from: string;
}

export interface StoreRow {
  chain_id: string;
  store_id: string;
  sub_chain_id: string;
  chain_name: string;
  store_name: string;
  city: string;
  city_key: string;
  address: string;
}

/** "2025-02-18T15:52:25.000", "2025/02/18 15:52", "18/02/2025 15:52:25" → "YYYY-MM-DD HH:MM:SS" */
export function parseTimestamp(s: string | null | undefined): string | null {
  if (!s) return null;
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return ts(m[1]!, m[2]!, m[3]!, m[4], m[5], m[6]);
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return ts(m[3]!, m[2]!, m[1]!, m[4], m[5], m[6]);
  return null;
}

function ts(y: string, mo: string, d: string, h?: string, mi?: string, s?: string): string | null {
  const p = (x: string | undefined, n = 2) => (x ?? "0").padStart(n, "0");
  const yy = +y, mm = +mo, dd = +d;
  if (yy < 2000 || yy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${p(mo)}-${p(d)} ${p(h)}:${p(mi)}:${p(s)}`;
}

export function parsePriceAg(s: string): number | null {
  const v = parseFloat(s.replace(/[^\d.\-]/g, ""));
  if (!Number.isFinite(v) || v <= 0 || v > 100000) return null;
  return Math.round(v * 100);
}

export function toItem(r: Fields, chainId: string, fileTs: string): ItemRow | null {
  const code = pick(r, "itemcode", "itemid", "barcode", "code");
  const barcode = productKey(chainId, code, r["itemtype"]);
  if (!barcode) return null;
  const price_ag = parsePriceAg(pick(r, "itemprice", "price"));
  if (price_ag == null) return null;
  const qty = parseFloat(pick(r, "quantity", "qty").replace(/[^\d.]/g, ""));
  const w = pick(r, "bisweighted", "isweighted", "weighted").toLowerCase();
  return {
    barcode,
    name: cleanText(pick(r, "itemname", "itemnm", "itemdescription", "manufactureritemdescription", "manufactureitemdescription")),
    manufacturer: cleanText(pick(r, "manufacturername", "manufacturename", "manufacturer")),
    quantity: Number.isFinite(qty) && qty > 0 ? qty : null,
    unit_qty: cleanText(pick(r, "unitqty")),
    uom: cleanText(pick(r, "unitofmeasure", "unitmeasure")),
    is_weighted: w === "1" || w === "true",
    price_ag,
    valid_from: parseTimestamp(pick(r, "priceupdatedate", "priceupdatetime", "updatedate")) ?? fileTs,
  };
}

const matchers = new WeakMap<CityCodeMap, (t: string) => string | null>();
function matcherFor(codes: CityCodeMap) {
  let m = matchers.get(codes);
  if (!m) matchers.set(codes, (m = buildCityMatcher(codes.values())));
  return m;
}

export function toStore(r: Fields, ctx: Fields, fileChainId: string, codes?: CityCodeMap): StoreRow | null {
  const store_id = normId(pick(r, "storeid", "storenum", "branchid"));
  if (!store_id) return null;
  const chain_id = pick(r, "chainid") || ctx["chainid"] || fileChainId;
  const cityRaw = pick(r, "city", "cityname");
  let city = resolveCityName(cityRaw, codes);
  if (!city && codes?.size) {
    city = matcherFor(codes)(pick(r, "storename", "branchname")) ?? "";
  }
  return {
    chain_id,
    store_id,
    sub_chain_id: normId(pick(r, "subchainid") || ctx["subchainid"] || "") ?? "",
    chain_name: cleanText(pick(r, "chainname") || ctx["chainname"] || ""),
    store_name: cleanText(pick(r, "storename", "branchname")),
    city: cleanText(city),
    city_key: normalizeCity(city),
    address: cleanText(pick(r, "address", "storeaddress")),
  };
}
