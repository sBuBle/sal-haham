/**
 * פרסר SAX גנרי לקובצי חוק המזון.
 * לא בונה DOM: שומר רק את הרשומה הנוכחית (Item/Store) ואת שדות ה"הקשר" ברמת המסמך
 * (ChainId, StoreId, SubChainId...). שמות התגים מנורמלים לאותיות קטנות ובלי namespace,
 * כך ש-StoreId / StoreID / STOREID / asx:STOREID הם אותו שדה.
 */
import { SaxesParser } from "saxes";

export type RecordKind = "item" | "store" | "promo";

/** תגים שמסמנים רשומה. "product" מופיע אצל חלק מהרשתות במקום item. */
const RECORD_TAGS: Record<string, RecordKind> = {
  item: "item",
  product: "item",
  store: "store",
  branch: "store",
  promotion: "promo",
  sale: "promo",
};

export type Fields = Record<string, string>;

export interface ParseStats {
  records: number;
  errors: number;
  firstError: string | null;
}

/** ניקוי טקסט: רווחים כפולים, טאבים, שורות חדשות, NBSP */
export function clean(s: string): string {
  return s.replace(/[\s ]+/g, " ").trim();
}

const BARE_AMP = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g;
const HTML_ENTITIES: Record<string, string> = { nbsp: "#160", shy: "#173", ndash: "#8211", mdash: "#8212", quot: "quot", amp: "amp", lt: "lt", gt: "gt", apos: "apos" };
export function fixEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replace(BARE_AMP, "&amp;")
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name: string) => {
      const v = HTML_ENTITIES[name];
      return v ? `&${v};` : `&amp;${name};`;
    });
}

const localName = (n: string) => {
  const i = n.indexOf(":");
  return (i >= 0 ? n.slice(i + 1) : n).toLowerCase();
};

/**
 * מפרסר זרם טקסט. onRecord נקרא סינכרונית לכל רשומה; flush נקרא (ומחכים לו)
 * אחרי כל מקטע קלט, כדי שהצרכן יוכל לכתוב באצוות ולשמור על זיכרון חסום.
 */
export async function parseRecords(
  chunks: AsyncIterable<string>,
  onRecord: (kind: RecordKind, rec: Fields, ctx: Fields) => void,
  flush?: () => Promise<void> | void,
  want: RecordKind[] = ["item", "store"],
): Promise<{ ctx: Fields; stats: ParseStats }> {
  const wanted = new Set(want);
  const parser = new SaxesParser({ xmlns: false, position: false });
  const ctx: Fields = {};
  const stats: ParseStats = { records: 0, errors: 0, firstError: null };

  // מחסנית: לכל אלמנט פתוח — שם, האם יש לו ילדים
  const names: string[] = [];
  const hasChild: boolean[] = [];
  let text = "";
  let rec: Fields | null = null;
  let recKind: RecordKind | null = null;
  let recDepth = -1;

  parser.on("error", (e) => {
    stats.errors++;
    if (!stats.firstError) stats.firstError = String(e.message).slice(0, 200);
  });
  parser.on("opentag", (tag) => {
    if (hasChild.length) hasChild[hasChild.length - 1] = true;
    const name = localName(tag.name);
    names.push(name);
    hasChild.push(false);
    text = "";
    if (!rec && RECORD_TAGS[name] && wanted.has(RECORD_TAGS[name]!)) {
      // רשומה = Item/Store שיש בתוכה שדות. מיכלים כמו <Items> לא נכללים כי הם ברבים.
      rec = {};
      recKind = RECORD_TAGS[name]!;
      recDepth = names.length;
    }
    // תכונות (יש רשתות ששמות ערכים כ-attributes)
    if (rec) {
      for (const [k, v] of Object.entries(tag.attributes)) {
        const kk = localName(k);
        if (typeof v === "string" && v && rec[kk] === undefined) rec[kk] = clean(v);
      }
    }
  });
  parser.on("text", (t) => {
    text += t;
  });
  parser.on("cdata", (t) => {
    text += t;
  });
  parser.on("closetag", () => {
    const depth = names.length;
    const name = names.pop()!;
    const leaf = !hasChild.pop();
    if (rec) {
      if (depth === recDepth) {
        stats.records++;
        onRecord(recKind!, rec, ctx);
        rec = null;
        recKind = null;
        recDepth = -1;
      } else if (leaf) {
        const v = clean(text);
        if (rec[name] === undefined || rec[name] === "") rec[name] = v;
      }
    } else if (leaf) {
      const v = clean(text);
      if (v) ctx[name] = v;
    }
    text = "";
  });

  await feedXml(parser, chunks, flush);
  return { ctx, stats };
}

/**
 * מזין זרם טקסט לפרסר. "&" לא מקודד (למשל "A & B" בשם מוצר) גורם ל-saxes לבלוע את שאר הקובץ — מתקנים בזרם.
 * "&" שנחתך בסוף מקטע נשמר למקטע הבא.
 */
export async function feedXml(parser: SaxesParser, chunks: AsyncIterable<string>, flush?: () => Promise<void> | void): Promise<void> {
  let carry = "";
  for await (const chunk of chunks) {
    let s = carry + chunk;
    carry = "";
    const amp = s.lastIndexOf("&");
    if (amp >= 0 && s.length - amp < 12 && !s.includes(";", amp)) {
      carry = s.slice(amp);
      s = s.slice(0, amp);
    }
    parser.write(fixEntities(s));
    if (flush) await flush();
  }
  if (carry) parser.write(fixEntities(carry));
  parser.close();
  if (flush) await flush();
}
