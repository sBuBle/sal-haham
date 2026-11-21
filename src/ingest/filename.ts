/**
 * פרסור שמות קבצים של חוק המזון. שתי תבניות עיקריות:
 *   {Kind}{ChainId}-{SubChain}-{StoreId}-{yyyymmdd}-{hhmmss}   (Cerberus, Bina)
 *   {Kind}{ChainId}-{StoreId}-{yyyymmddhhmm}                    (שופרסל ואחרים)
 * ובנוסף Stores{ChainId}-{SubChain}-{yyyymmdd}-{hhmmss} וכדומה.
 */

export type FileKind = "Stores" | "PriceFull" | "Price" | "PromoFull" | "Promo";

export interface ParsedFileName {
  kind: FileKind;
  chainId: string;
  subChainId: string | null;
  /** מזהה סניף מנורמל (בלי אפסים מובילים), null לקובצי Stores */
  storeId: string | null;
  /** זמן הקובץ, "YYYY-MM-DD HH:MM:SS" (שעון ישראל, כפי שבשם) */
  timestamp: string;
  /** סיומת אחרונה (gz/xml/zip) באותיות קטנות */
  ext: string;
}

const KIND_RE = /^(StoresFull|Stores|PriceFull|Price|PromoFull|Promo)(\d{13})(?:-(.*))?$/i;

const KIND_CANON: Record<string, FileKind> = {
  storesfull: "Stores",
  stores: "Stores",
  pricefull: "PriceFull",
  price: "Price",
  promofull: "PromoFull",
  promo: "Promo",
};

export function normId(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return String(parseInt(t, 10));
  return t;
}

function fmt(y: string, mo: string, d: string, h = "00", mi = "00", s = "00") {
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function validDate(y: string, mo: string, d: string) {
  const yy = +y, mm = +mo, dd = +d;
  return yy >= 2000 && yy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

export function parseFileName(fileName: string): ParsedFileName | null {
  const base = fileName.split(/[\\/]/).pop()!;
  const extMatch = base.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1]!.toLowerCase() : "";
  const stem = base.replace(/(\.(gz|xml|zip|gzip))+$/i, "");
  const m = stem.match(KIND_RE);
  if (!m) return null;
  const kind = KIND_CANON[m[1]!.toLowerCase()]!;
  const chainId = m[2]!;
  const rest = (m[3] ?? "").split("-").filter((x) => x !== "");

  // מוצאים את טוקן התאריך: 8 ספרות (yyyymmdd) או 12/14 ספרות (yyyymmddhhmm[ss])
  let dateIdx = -1;
  let timestamp = "";
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!;
    if (/^\d{8}$/.test(t) && validDate(t.slice(0, 4), t.slice(4, 6), t.slice(6, 8))) {
      const next = rest[i + 1];
      let h = "00", mi = "00", s = "00";
      if (next && /^\d{6}$/.test(next)) { h = next.slice(0, 2); mi = next.slice(2, 4); s = next.slice(4, 6); }
      else if (next && /^\d{4}$/.test(next)) { h = next.slice(0, 2); mi = next.slice(2, 4); }
      timestamp = fmt(t.slice(0, 4), t.slice(4, 6), t.slice(6, 8), h, mi, s);
      dateIdx = i;
      break;
    }
    if (/^\d{12}(\d{2})?$/.test(t) && validDate(t.slice(0, 4), t.slice(4, 6), t.slice(6, 8))) {
      timestamp = fmt(t.slice(0, 4), t.slice(4, 6), t.slice(6, 8), t.slice(8, 10), t.slice(10, 12), t.length === 14 ? t.slice(12, 14) : "00");
      dateIdx = i;
      break;
    }
  }
  if (dateIdx < 0) return null;
  const ids = rest.slice(0, dateIdx);
  let subChainId: string | null = null;
  let storeId: string | null = null;
  if (kind === "Stores") {
    subChainId = ids[0] ?? null;
  } else if (ids.length >= 2) {
    subChainId = ids[0]!;
    storeId = normId(ids[1]!);
  } else if (ids.length === 1) {
    storeId = normId(ids[0]!);
  }
  return { kind, chainId, subChainId, storeId, timestamp, ext };
}

/** סדר עיבוד: Stores קודם, אחר כך לפי זמן; באותו זמן — Full לפני עדכון */
export function ingestOrder(a: ParsedFileName, b: ParsedFileName): number {
  const rank = (k: FileKind) => (k === "Stores" ? 0 : 1);
  if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  const full = (k: FileKind) => (k.endsWith("Full") ? 0 : 1);
  return full(a.kind) - full(b.kind);
}
