/**
 * ברקוד קנוני: רק ספרות, בלי אפסים מובילים (UPC-A שנסרק כ-EAN-13 עם 0 מוביל
 * והרשתות שמרפדות באפסים — כולם נופלים לאותו מפתח).
 * קוד פנימי של רשת (ItemType=0) נשמר כ-"chain:code" כדי לא להתנגש בין רשתות.
 */
export function normBarcode(code: string | null | undefined): string {
  if (!code) return "";
  const t = String(code).trim();
  if (/^\d+$/.test(t)) return t.replace(/^0+(?=\d)/, "");
  return t.replace(/\s+/g, "");
}

export function productKey(chainId: string, code: string, itemType: string | null | undefined): string {
  const bc = normBarcode(code);
  if (!bc) return "";
  if (itemType != null && String(itemType).trim() === "0") return `${chainId}:${bc}`;
  return bc;
}
