/**
 * מחיר ליחידת מידה. הרשתות לא אחידות: יש ששמות את היחידה ב-UnitQty ("גרם") ואת
 * Quantity=500, ויש ששמות UnitQty="לא ידוע" ואת היחידה ב-UnitOfMeasure ("ליטר", Quantity=1.32).
 * לכן בודקים קודם את UnitQty ואם הוא לא מזוהה, את UnitOfMeasure.
 */

export type Unit = "g" | "kg" | "ml" | "l" | "unit";

export function parseUnit(text: string | null | undefined): Unit | null {
  if (!text) return null;
  const t = text.replace(/["'״׳`.]/g, "").replace(/\d+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!t) return null;
  const words = t.split(" ");
  const has = (...w: string[]) => words.some((x) => w.includes(x));
  if (has("מל", "מיליליטר", "מיליליטרים", "ml", "מלל")) return "ml";
  if (has("קג", "קילו", "קילוגרם", "קילוגרמים", "kg")) return "kg";
  if (has("ליטר", "ליטרים", "ל", "lt", "ltr", "liter", "l")) return "l";
  if (has("גרם", "גר", "גרמים", "g", "gr", "גרמ")) return "g";
  if (has("יחידה", "יחידות", "יח", "unit", "units")) return "unit";
  return null;
}

export interface UnitPrice {
  /** אגורות ליחידת ההשוואה */
  ag: number;
  /** "100 גרם" או "ליטר" */
  per: "100 גרם" | "ליטר";
}

export interface UnitInfo {
  quantity?: number | null;
  unit_qty?: string | null;
  uom?: string | null;
  is_weighted?: boolean | null;
}

/** מחשב מחיר ל-100 גרם (מוצקים) או לליטר (נוזלים). מחזיר null כשאין מספיק מידע. */
export function unitPrice(priceAg: number, info: UnitInfo): UnitPrice | null {
  if (!(priceAg > 0)) return null;
  if (info.is_weighted) {
    // מוצר שקיל: ItemPrice הוא מחיר לק"ג
    return { ag: priceAg / 10, per: "100 גרם" };
  }
  const q = Number(info.quantity);
  if (!(q > 0) || !Number.isFinite(q)) return null;
  const unit = parseUnit(info.unit_qty) ?? parseUnit(info.uom);
  switch (unit) {
    case "g":
      return { ag: (priceAg * 100) / q, per: "100 גרם" };
    case "kg":
      return { ag: (priceAg * 100) / (q * 1000), per: "100 גרם" };
    case "ml":
      return { ag: (priceAg * 1000) / q, per: "ליטר" };
    case "l":
      return { ag: priceAg / q, per: "ליטר" };
    default:
      return null;
  }
}

/** סוג המידה להשוואה: משקל (ל-100 גרם) או נפח (לליטר). מוצרים מסוגים שונים לא מושווים. */
export function unitKind(info: UnitInfo): "mass" | "volume" | null {
  const u = unitPrice(100, info);
  return !u ? null : u.per === "ליטר" ? "volume" : "mass";
}

export function formatShekel(ag: number): string {
  return "₪" + (ag / 100).toFixed(2);
}

export function formatUnitPrice(u: UnitPrice | null): string {
  if (!u) return "";
  return `${formatShekel(Math.round(u.ag))} ${u.per === "ליטר" ? "לליטר" : "ל-100 גרם"}`;
}

/** תיאור גודל אריזה קצר, למשל "500 גרם" או "1.5 ליטר" */
export function packSize(info: UnitInfo): string {
  if (info.is_weighted) return "שקיל, לק\"ג";
  const q = Number(info.quantity);
  if (!(q > 0)) return "";
  const unit = parseUnit(info.unit_qty) ?? parseUnit(info.uom);
  const n = Number.isInteger(q) ? String(q) : String(+q.toFixed(3));
  switch (unit) {
    case "g": return `${n} גרם`;
    case "kg": return `${n} ק"ג`;
    case "ml": return `${n} מ"ל`;
    case "l": return `${n} ליטר`;
    case "unit": return q === 1 ? "" : `${n} יח'`;
    default: return "";
  }
}
