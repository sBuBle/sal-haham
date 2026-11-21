/**
 * נרמול טקסט לחיפוש. אותו כלל ממומש ב-SQL (SEARCH_KEY_SQL) בזמן הייצוא וב-JS בזמן החיפוש.
 */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'`״׳]/g, "")
    .replace(/[-‐-―־_/\\,.()+*%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ביטוי SQL (DuckDB) שמחשב את אותו נרמול על עמודת name */
export const SEARCH_KEY_SQL = (col: string) =>
  `trim(regexp_replace(regexp_replace(regexp_replace(lower(${col}), '["''\`״׳]', '', 'g'), '[-‐-―־_/\\\\,.()+*%]', ' ', 'g'), '\\s+', ' ', 'g'))`;

/** פיצול שאילתה לטוקנים; מחזיר גם האם זו שאילתת ברקוד */
export function parseQuery(q: string): { barcode: string | null; tokens: string[] } {
  const t = q.trim();
  if (/^\d{4,14}$/.test(t)) return { barcode: t, tokens: [] };
  const n = normalizeSearch(t);
  return { barcode: null, tokens: n ? n.split(" ").filter(Boolean) : [] };
}

export const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;
