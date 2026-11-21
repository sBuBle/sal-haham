/**
 * רשימת הרשתות והמנוע של כל אחת. פרטי הכניסה ל-Cerberus הם הציבוריים שמפורסמים
 * ברשימה הרשמית (gov.il/he/pages/cpfta_prices_regulations); לרוב הסיסמה ריקה.
 */
import { bina, carrefour, cerberus, haziHinam, shufersal, superPharm, type Engine } from "./engines.ts";

export interface ChainSource {
  id: string;
  name: string;
  engine: "cerberus" | "bina" | "shufersal" | "carrefour" | "hazihinam" | "superpharm" | "unsupported";
  make?: () => Engine;
  note?: string;
}

const cerb = (id: string, name: string, user: string, pass = ""): ChainSource => ({
  id, name, engine: "cerberus", make: () => cerberus(user, pass),
});
const bn = (id: string, name: string, sub: string): ChainSource => ({ id, name, engine: "bina", make: () => bina(sub) });
const unsupported = (id: string, name: string, note: string): ChainSource => ({ id, name, engine: "unsupported", note });

export const CHAINS: ChainSource[] = [
  // Cerberus
  cerb("osherad", "אושר עד", "osherad"),
  cerb("ramilevi", "רמי לוי", "RamiLevi"),
  cerb("yohananof", "יוחננוף", "yohananof"),
  cerb("tivtaam", "טיב טעם", "TivTaam"),
  cerb("keshet", "קשת טעמים", "Keshet"),
  cerb("freshmarket", "פרש מרקט", "freshmarket"),
  cerb("stopmarket", "סטופ מרקט", "Stop_Market"),
  cerb("doralon", "דור אלון", "doralon"),
  cerb("politzer", "פוליצר", "politzer"),
  cerb("cofix", "סופר קופיקס", "SuperCofixApp"),
  cerb("salachd", "סאלח דבאח", "SalachD", "12345"),
  cerb("yuda", "סופר יודה", "yuda_ho", "Yud@147"),
  cerb("yellow", "יילו (פז)", "Paz_bo", "paz468"),
  // Bina
  bn("kingstore", "קינג סטור", "kingstore"),
  bn("zolvebegadol", "זול ובגדול", "zolvebegadol"),
  bn("superbareket", "סופר ברקת", "superbareket"),
  bn("supersapir", "סופר ספיר", "supersapir"),
  bn("shukhayir", "שוק העיר", "shuk-hayir"),
  bn("maayan2000", "מעיין 2000", "maayan2000"),
  bn("goodpharm", "גוד פארם", "goodpharm"),
  // אתרים ייעודיים
  { id: "shufersal", name: "שופרסל", engine: "shufersal", make: () => shufersal() },
  { id: "carrefour", name: "קרפור", engine: "carrefour", make: () => carrefour() },
  { id: "hazihinam", name: "חצי חינם", engine: "hazihinam", make: () => haziHinam() },
  { id: "superpharm", name: "סופר-פארם", engine: "superpharm", make: () => superPharm() },
  // laibcatalog.co.il (ניביט): נבדק 19.11.2026 — האתר מפרסם רק קובץ סניפים ריק של ח. כהן, בלי מחירים לאף רשת
  unsupported("victory", "ויקטורי", "laibcatalog.co.il לא מפרסם כרגע קבצים של ויקטורי"),
  unsupported("mshuk", "מחסני השוק", "laibcatalog.co.il לא מפרסם כרגע קבצים של מחסני השוק"),
  unsupported("hcohen", "ח. כהן", "laibcatalog.co.il מפרסם רק קובץ סניפים ריק"),
];

export const chainById = (id: string) => CHAINS.find((c) => c.id === id.toLowerCase());
