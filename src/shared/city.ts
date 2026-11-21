/**
 * נרמול שמות ערים. משמש גם ב-ingest (לבניית city_key) וגם בדפדפן (להשלמה אוטומטית),
 * כך ש"קריית אונו", "קרית-אונו" ו-"קרית אונו " נופלים לאותו מפתח.
 */

const QUOTES = /["'`״׳‘’“”]/g;
const DASHES = /[-‐-―־_]/g; // מקף, מקפים טיפוגרפיים, מקף עברי (מקאף)
const NIQQUD = /[֑-ׇ]/g;

/** כינויים נפוצים → צורה קנונית (אחרי הסרת גרשיים ומקפים) */
const ALIASES: Record<string, string> = {
  "תל אביב יפו": "תל אביב",
  "תא": "תל אביב",
  "יפו": "תל אביב",
  "פתח תקוה": "פתח תקווה",
  "ראשלצ": "ראשון לציון",
  "באר שבע": "באר שבע",
  "י ם": "ירושלים",
  "מודיעין מכבים רעות": "מודיעין",
  "נצרת עלית": "נוף הגליל",
  "הרצלייה": "הרצליה",
  "גבעתים": "גבעתיים",
  "נהרייה": "נהריה",
};

export function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

/** מחזיר את המפתח הקנוני של עיר, או "" אם אין שם. */
export function normalizeCity(raw: string | null | undefined): string {
  let s = cleanText(raw);
  if (!s) return "";
  s = s.replace(DASHES, " "); // לפני הסרת הניקוד: המקף העברי (U+05BE) נמצא בטווח הניקוד
  s = s.replace(NIQQUD, "");
  s = s.replace(/קריית/g, "קרית");
  s = s.replace(QUOTES, ""); // "ת"א" → "תא", שנתפס בכינויים
  s = s.replace(/[(),.]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.toLowerCase();
  if (ALIASES[s]) s = ALIASES[s]!;
  // "תל אביב יפו" גם כשיש תוספות כמו "תל אביב יפו מרכז"
  if (s.startsWith("תל אביב")) s = "תל אביב";
  return s;
}

/** האם מחרוזת היא קוד יישוב מספרי של הלמ"ס (חלק מהרשתות מפרסמות קוד במקום שם). */
export function isCityCode(raw: string | null | undefined): boolean {
  return !!raw && /^\s*\d{1,5}\s*$/.test(raw);
}

export type CityCodeMap = Map<string, string>;

/**
 * מתרגם שדה City גולמי לשם עיר. קוד מספרי ממופה דרך רשימת הלמ"ס (data/ref/cities.json).
 * קוד שלא נמצא ברשימה מוחזר כ"קוד יישוב N" כדי לא להמציא שם.
 */
export function resolveCityName(raw: string | null | undefined, codes?: CityCodeMap): string {
  const s = cleanText(raw);
  if (!s) return "";
  if (isCityCode(s)) {
    const code = String(parseInt(s, 10));
    if (code === "0") return "";
    return codes?.get(code) ?? `קוד יישוב ${code}`;
  }
  return s;
}

/** שם תצוגה לעיר מתוך המפתח הקנוני (המפתח כבר קריא בעברית). */
export function displayCity(key: string): string {
  return key;
}

/** חיפוש ערים להשלמה אוטומטית: התאמת תחילית קודמת להתאמה בתוך המחרוזת. */
export function matchCities<T extends { key: string; name: string }>(cities: T[], query: string, limit = 8): T[] {
  const q = normalizeCity(query);
  if (!q) return [];
  const prefix: T[] = [];
  const inner: T[] = [];
  for (const c of cities) {
    if (c.key.startsWith(q)) prefix.push(c);
    else if (c.key.includes(q) || c.key.split(" ").some((w) => w.startsWith(q))) inner.push(c);
  }
  return [...prefix, ...inner].slice(0, limit);
}

/**
 * גיבוי לרשתות שמפרסמות City ריק או 0 (למשל יוחננוף): מחפשים שם יישוב מרשימת הלמ"ס
 * בתוך שם הסניף. ההתאמה הארוכה ביותר מנצחת ("גן יבנה" לפני "יבנה"), רק מילים שלמות.
 * לא מחפשים בכתובת: שם רחוב כמו "אלון" או "אזור התעשיה" הוא גם שם של יישוב.
 */
export function buildCityMatcher(names: Iterable<string>): (text: string) => string | null {
  const keys = new Map<string, string>();
  for (const n of names) {
    const k = normalizeCity(n);
    if (k.length >= 3 && !keys.has(k)) keys.set(k, n);
  }
  // כינויים מקוצרים ("ראשלצ", "תא") שמופיעים בשמות סניפים
  for (const [alias, target] of Object.entries(ALIASES)) if (!keys.has(alias)) keys.set(alias, target);
  const sorted = [...keys.keys()].sort((a, b) => b.length - a.length);
  return (text: string) => {
    const t = ` ${normalizeCity(text)} `;
    for (const k of sorted) if (t.includes(` ${k} `)) return keys.get(k)!;
    return null;
  };
}
