/**
 * שוק = מדינה + מטבע + שפת ברירת מחדל + יחידות + מקור נתונים.
 * הממשק לא מקודד מטבע או רשתות: הכול עובר דרך השוק הפעיל.
 * כרגע יש נתונים רק לישראל. שוק חדש = רשומה כאן + צינור איסוף שמייצא לאותו פורמט.
 */
export type Lang = "he" | "en";

export interface Market {
  id: string;
  /** שם המדינה בכל שפה */
  name: Record<Lang, string>;
  /** BCP-47, לעיצוב מספרים ותאריכים */
  locale: string;
  /** ISO 4217 */
  currency: string;
  /** כמה יחידות קטנות במטבע (אגורות, סנטים) */
  minor: number;
  defaultLang: Lang;
  units: "metric" | "imperial";
  /** בסיס הנתונים הסטטיים של השוק */
  dataBase: string;
  /** מקור המחירים, להצגה למשתמש */
  source: Record<Lang, string>;
  flag: string;
}

export const MARKETS: Market[] = [
  {
    id: "il",
    name: { he: "ישראל", en: "Israel" },
    locale: "he-IL",
    currency: "ILS",
    minor: 100,
    defaultLang: "he",
    units: "metric",
    dataBase: "./data/",
    source: {
      he: "הקבצים שהרשתות מחויבות לפרסם לפי חוק המזון (2014)",
      en: "Files chains must publish under Israel's Food Act (2014)",
    },
    flag: "🇮🇱",
  },
];

export const marketById = (id: string | null | undefined) => MARKETS.find((m) => m.id === id) ?? MARKETS[0]!;

const fmtCache = new Map<string, Intl.NumberFormat>();
/** סכום ביחידות קטנות (אגורות) → מחרוזת מקומית עם מטבע, למשל "‏12.90 ‏₪" או "$12.90" */
export function formatMoney(minor: number, m: Market, locale = m.locale): string {
  const key = `${locale}|${m.currency}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency: m.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    fmtCache.set(key, f);
  }
  return f.format(minor / m.minor);
}

export function formatDate(iso: string | null | undefined, locale: string, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "medium" });
}
