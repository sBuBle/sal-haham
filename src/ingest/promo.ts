/**
 * קובצי מבצעים (Promo / PromoFull) של חוק המזון.
 *
 * המבנה (אחיד אצל כל הרשתות שנבדקו ב-20.11.2026: רמי לוי, שופרסל, קרפור, קינג סטור, יילו):
 *   Promotion → Groups → Group → PromotionItems → PromotionItem
 * שדות המבצע (תיאור, תאריכים, מועדון, קופון) ברמת Promotion; סוג ההטבה, הכמות והמחיר ברמת הפריט.
 * הפרסר מקבל גם את המבנה הישן (PromotionItems/Item ישירות תחת Promotion, שדות ההטבה ברמת המבצע).
 *
 * מה נחשב "מבצע שאפשר להציג":
 *   - מחיר מבצע: DiscountedPrice הוא המחיר ל-MinQty יחידות ("2 ב-24" → MinQty=2, 24.00; "ב-9.90" → MinQty=1).
 *     במוצר שקיל MinQty=0.01 והמחיר הוא לק"ג.
 *   - "1+1" / "2+1": קבוצת תנאי (RewardType=0) וקבוצת הטבה ב-100% הנחה על אותם פריטים.
 *   - תנאי "בקנייה מעל X ₪": MinPurchaseAmount בקבוצה (לעיתים בקבוצה נפרדת עם קוד פריט 0000000000000).
 * מה לא נכלל: קופונים (AdditionalIsCoupon=1 או "קופון"/"שובר"/"פיצוי" בתיאור), מתנות (מחיר 0),
 * הטבות למצטרפים/לעובדים, אמצעי תשלום ("תו זהב"), מבצע שתלוי בקניית פריטים אחרים, ומבצע לימים מסוימים בשבוע.
 */
import { SaxesParser } from "saxes";
import { clean, feedXml, type Fields, type ParseStats } from "./parser.ts";
import { productKey } from "../shared/barcode.ts";
import { parseTimestamp } from "./records.ts";

export interface RawGroup { fields: Fields; items: Fields[] }
export interface RawPromo { fields: Fields; groups: RawGroup[] }

const localName = (n: string) => {
  const i = n.indexOf(":");
  return (i >= 0 ? n.slice(i + 1) : n).toLowerCase();
};

const PROMO_TAGS = new Set(["promotion", "sale"]);
const ITEM_TAGS = new Set(["promotionitem", "item"]);

/** פרסר SAX בהזרמה: מחזיק בזיכרון מבצע אחד בכל רגע. */
export async function parsePromos(
  chunks: AsyncIterable<string>,
  onPromo: (p: RawPromo, ctx: Fields) => void,
): Promise<{ ctx: Fields; stats: ParseStats }> {
  const parser = new SaxesParser({ xmlns: false, position: false });
  const ctx: Fields = {};
  const stats: ParseStats = { records: 0, errors: 0, firstError: null };
  const names: string[] = [];
  const hasChild: boolean[] = [];
  let text = "";
  let promo: RawPromo | null = null;
  let promoDepth = -1;
  let group: RawGroup | null = null;
  let groupDepth = -1;
  let item: Fields | null = null;
  let itemDepth = -1;

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
    if (!promo) {
      if (PROMO_TAGS.has(name)) { promo = { fields: {}, groups: [] }; promoDepth = names.length; }
    } else if (!item && name === "group") {
      group = { fields: {}, items: [] };
      groupDepth = names.length;
    } else if (!item && ITEM_TAGS.has(name)) {
      item = {};
      itemDepth = names.length;
    }
  });
  parser.on("text", (t) => { text += t; });
  parser.on("cdata", (t) => { text += t; });
  parser.on("closetag", () => {
    const depth = names.length;
    const name = names.pop()!;
    const leaf = !hasChild.pop();
    const v = leaf ? clean(text) : "";
    text = "";
    if (!promo) {
      if (leaf && v) ctx[name] = v;
      return;
    }
    if (item) {
      if (depth === itemDepth) {
        // פריט בלי קבוצה (מבנה ישן) → קבוצה אחת משתמעת
        if (!group) {
          if (!promo.groups.length) promo.groups.push({ fields: {}, items: [] });
          promo.groups[promo.groups.length - 1]!.items.push(item);
        } else group.items.push(item);
        item = null;
        itemDepth = -1;
      } else if (leaf && (item[name] === undefined || item[name] === "")) item[name] = v;
      return;
    }
    if (group) {
      if (depth === groupDepth) { promo.groups.push(group); group = null; groupDepth = -1; }
      else if (leaf && (group.fields[name] === undefined || group.fields[name] === "")) group.fields[name] = v;
      return;
    }
    if (depth === promoDepth) {
      stats.records++;
      onPromo(promo, ctx);
      promo = null;
      promoDepth = -1;
    } else if (leaf) {
      // כמה ClubId (מבנה ישן: <Clubs><ClubId>…) נשמרים כולם
      if (name === "clubid" && promo.fields[name] && v) promo.fields[name] += "|" + v;
      else if (promo.fields[name] === undefined || promo.fields[name] === "") promo.fields[name] = v;
    }
  });

  await feedXml(parser, chunks);
  return { ctx, stats };
}

// ---------------------------------------------------------------- normalisation
export interface PromoItemRow {
  promo_id: string;
  barcode: string;
  descr: string;
  /** "YYYY-MM-DD HH:MM:SS" */
  start_at: string | null;
  /** היום האחרון של המבצע, "YYYY-MM-DD" */
  end_date: string | null;
  club: boolean;
  /** price: total_ag הוא המחיר ל-min_qty יחידות. free: קונים min_qty יחידות ומשלמים על min_qty - free_qty. */
  kind: "price" | "free";
  min_qty: number;
  total_ag: number;
  free_qty: number;
  /** כמה יחידות (או ק"ג) לכל היותר במחיר המבצע */
  max_qty: number | null;
  /** המבצע תקף רק בקנייה מעל הסכום הזה (אגורות) */
  min_purchase_ag: number | null;
}

/** תיאורים של הטבות שאינן מחיר מדף לכל לקוח */
const NOT_A_DEAL = /קופון|שובר|פיצוי|מצטרפ|הצטרפות|עובדים|לעובד|תו זהב|תו הזהב|תווי|טסט|בדיקה|test|coupon/i;

const num = (s: string | undefined): number | null => {
  if (s == null || s === "") return null;
  const v = parseFloat(s.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(v) ? v : null;
};

/** "0", "", "0 - כלל הלקוחות" (שופרסל, טיב טעם), "0=אין" (סופר-פארם) = לכל הלקוחות.
 *  כל ערך אחר — גם "0=מועדון קרפור אשראי" — הוא מועדון / אמצעי תשלום מסוים. */
const NO_CLUB_NAME = /^(אין|ללא|לא|כולם|כלל.*|none|all)?$/i;
export function isClub(clubId: string | undefined): boolean {
  const parts = (clubId ?? "").replace(/[()"]/g, " ").split(/[|&]/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^0+\s*(?:[=-]\s*(.*))?$/);
    if (!m || !NO_CLUB_NAME.test((m[1] ?? "").trim())) return true;
  }
  return false;
}

/** היום האחרון של המבצע. שופרסל כותבת "…T02:59" (סוף היום הקודם בשעון UTC+3); "…T00:00" = עד סוף אותו יום. */
export function endDate(s: string | undefined, hour?: string): string | null {
  const ts = parseTimestamp(s);
  if (!ts) return null;
  const day = ts.slice(0, 10);
  const time = ts.slice(11);
  if (time > "00:00:00" && time < "06:00:00" && !hour) {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return day;
}

const ALL_DAYS = /^\s*$|^(?=.*1)(?=.*2)(?=.*3)(?=.*4)(?=.*5)(?=.*6)(?=.*7).*$/;

/** מבצע גולמי → שורה לכל פריט שאפשר להציג לו מחיר מבצע. מחזיר [] למבצע שלא נכלל. */
export function promoRows(p: RawPromo, chainId: string): PromoItemRow[] {
  const f = p.fields;
  const promo_id = (f["promotionid"] ?? "").trim();
  const descr = (f["promotiondescription"] ?? "").trim();
  if (!promo_id) return [];
  if ((f["additionaliscoupon"] ?? "0").trim() === "1") return [];
  if (NOT_A_DEAL.test(descr) || NOT_A_DEAL.test(f["remarks"] ?? "")) return [];
  if (!ALL_DAYS.test(f["promotiondays"] ?? "")) return [];
  const start_at = parseTimestamp(f["promotionstartdatetime"] ?? f["promotionstartdate"]);
  const end_date = endDate(f["promotionenddatetime"] ?? f["promotionenddate"]);
  if (!end_date) return [];
  const club = isClub(f["clubid"]);

  // ערך של פריט, ואם חסר — של הקבוצה, ואם חסר — של המבצע (מבנה ישן)
  const val = (it: Fields, g: RawGroup, k: string) => (it[k] !== undefined && it[k] !== "" ? it[k] : g.fields[k] !== undefined && g.fields[k] !== "" ? g.fields[k] : f[k]);
  const isZero = (code: string | undefined) => !code || /^0+$/.test(code.trim());
  const rt = (it: Fields, g: RawGroup) => (val(it, g, "rewardtype") ?? "").trim();

  let minPurchase = 0;
  for (const g of p.groups) minPurchase = Math.max(minPurchase, num(g.fields["minpurchaseamount"] ?? g.fields["minpurchaseamnt"]) ?? 0);
  minPurchase = Math.max(minPurchase, num(f["minpurchaseamount"] ?? f["minpurchaseamnt"]) ?? 0);
  const min_purchase_ag = minPurchase > 0 ? Math.round(minPurchase * 100) : null;

  const reward = p.groups.filter((g) => g.items.some((it) => !["", "0"].includes(rt(it, g))));
  const cond = p.groups.filter((g) => !reward.includes(g) && g.items.some((it) => !isZero(it["itemcode"])));
  // כמה קבוצות הטבה = "דיל" שמרכיבים מכמה סוגי פריטים (כריך + שתייה): אין מחיר לפריט בודד
  if (reward.length !== 1) return [];
  // קבוצה של קוד 0000000000000 היא תנאי "קנייה מעל X". עם כמות > 1 או בלי סכום — תנאי על פריטים אחרים ("הגדלת סל"): לא נכלל.
  for (const g of p.groups) {
    if (reward.includes(g) || cond.includes(g) || !g.items.length) continue;
    const q = num(val(g.items[0]!, g, "minqty")) ?? 1;
    if (q > 1 && !((num(g.fields["minpurchaseamount"] ?? g.fields["minpurchaseamnt"]) ?? 0) > 0)) return [];
  }

  const limit = num(f["redemptionlimit"]);
  const out = new Map<string, PromoItemRow>();
  const base = { promo_id, descr, start_at, end_date, club, min_purchase_ag };

  if (cond.length) {
    // "N+M": קונים N מהפריטים ומקבלים M מאותם פריטים חינם. כל תנאי אחר (פריטים אחרים) — לא נכלל.
    if (cond.length !== 1 || reward.length !== 1) return [];
    const cg = cond[0]!, rg = reward[0]!;
    const buy = num(val(cg.items[0]!, cg, "minqty"));
    const codes = new Set(cg.items.map((it) => productKey(chainId, it["itemcode"] ?? "", it["itemtype"])));
    if (!(buy && buy >= 1 && buy <= 12 && Number.isInteger(buy))) return [];
    for (const it of rg.items) {
      const price = num(val(it, rg, "discountedprice")) ?? 0;
      const rate = num(val(it, rg, "discountrate")) ?? 0;
      const free = num(val(it, rg, "minqty")) ?? 0;
      const barcode = productKey(chainId, it["itemcode"] ?? "", it["itemtype"]);
      if (price > 0 || rate < 99.9 || !(free >= 1 && free <= buy && Number.isInteger(free)) || !barcode || isZero(it["itemcode"]) || !codes.has(barcode)) continue;
      const min_qty = buy + free;
      const max_qty = limit && limit > 0 && limit < 50 ? limit * min_qty : null;
      out.set(barcode, { ...base, barcode, kind: "free", min_qty, total_ag: 0, free_qty: free, max_qty });
    }
    return [...out.values()];
  }

  for (const g of reward) {
    for (const it of g.items) {
      if (isZero(it["itemcode"])) continue;
      const barcode = productKey(chainId, it["itemcode"] ?? "", it["itemtype"]);
      const price = num(val(it, g, "discountedprice")) ?? 0;
      if (!barcode || !(price > 0) || price > 100000) continue;
      const weighted = ["1", "true"].includes((val(it, g, "bisweighted") ?? val(it, g, "isweightedpromo") ?? "").trim().toLowerCase());
      const q = num(val(it, g, "minqty")) ?? 1;
      // שקיל: MinQty=0.01 (משקל מינימלי) והמחיר לק"ג. כמות לא שלמה במוצר רגיל — לא מבצע שאפשר לחשב.
      const min_qty = q < 1 ? 1 : q;
      if (!weighted && !Number.isInteger(min_qty)) continue;
      if (min_qty > 100) continue;
      const maxItem = num(val(it, g, "maxqty"));
      let max_qty: number | null = null;
      if (weighted) max_qty = maxItem && maxItem > 0 ? maxItem : limit && limit > 0 && limit < 50 ? limit : null;
      else if (limit && limit > 0 && limit < 50 && Number.isInteger(limit)) max_qty = limit * min_qty;
      else if (maxItem && maxItem > 0 && maxItem < 50) max_qty = Math.max(maxItem, min_qty);
      const row: PromoItemRow = { ...base, barcode, kind: "price", min_qty, total_ag: Math.round(price * 100), free_qty: 0, max_qty };
      const prev = out.get(barcode);
      if (!prev || row.total_ag / row.min_qty < prev.total_ag / prev.min_qty) out.set(barcode, row);
    }
  }
  return [...out.values()];
}
