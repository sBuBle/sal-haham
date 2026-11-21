/**
 * קטגוריות לפי שם המוצר. העץ ומילות המפתח: taxonomy.ts. נתוני חוק המזון לא כוללים קטגוריה.
 * השיוך מחושב פעם אחת בבניית הנתונים (export) ונשמר עם כל מוצר (cat, sub); האפליקציה משתמשת באותן פונקציות כגיבוי.
 */
import { normalizeSearch } from "./search.ts";
import { NO_DEPT, PRE_RULE_SKIP, PRE_RULES, TAXONOMY, type Dept, type Sub } from "./taxonomy.ts";
import overrides from "./category-overrides.json" with { type: "json" };
import mfrDomains from "./manufacturer-domains.json" with { type: "json" };

export interface Category { id: string; name: string; art: string; keywords: string[] }
export type SubCategory = Sub;
export { TAXONOMY };

export const CATEGORIES: Category[] = TAXONOMY.map((d) => ({ id: d.id, name: d.name, art: d.art, keywords: d.subs.flatMap((s) => s.kw) }));
export const SUBCATEGORIES: Record<string, SubCategory[]> = Object.fromEntries(TAXONOMY.map((d) => [d.id, d.subs]));
export const CATEGORY_EN: Record<string, string> = Object.fromEntries(TAXONOMY.map((d) => [d.id, d.en]));

// ---------------------------------------------------------------- matching: whole words, Hebrew prefixes, "*" = stem, "^" = start
// אותיות שימוש: ו/ש/מש/כש ואחריהן אות אחת מ־הבלמכ ("ובחלב", "שבקופסה"); "מו" אינו תחילית ("מוסטלה")
const PREFIX = /^(?:ו[הבלמשכ]?|ש[הבלמכ]?|מש|כש|[הבלמכ])/;
interface Kw { raw: string; words: string[]; stem: boolean; start: boolean; len: number }
const parseKw = (raw: string): Kw => {
  const start = raw.startsWith("^");
  const stem = raw.endsWith("*");
  const body = normalizeSearch(raw.replace(/^\^/, "").replace(/\*$/, ""));
  return { raw, words: body.split(" ").filter(Boolean), stem, start, len: body.length };
};
const wordIs = (w: string, k: string, stem: boolean, allowPrefix: boolean) => {
  if (stem ? w.startsWith(k) : w === k) return true;
  if (!allowPrefix) return false;
  // מילה קצרה (3 אותיות): רק ה/ו לפניה ("החלב"); "שברי" אינו "ש+ברי"
  if (k.length < 4) { if (k.length === 3 && /^[הו]/.test(w)) { const r = w.slice(1); return stem ? r.startsWith(k) : r === k; } return false; }
  const m = w.match(PREFIX);
  if (!m) return false;
  // "ו", "ה", "ב"… לפני המילה; מנסים אות אחת ושתיים
  for (let i = 1; i <= m[0].length; i++) { const r = w.slice(i); if (stem ? r.startsWith(k) : r === k) return true; }
  return false;
};
/** אינדקס המילה שבה הביטוי מתחיל, או -1 */
function find(tokens: string[], kw: Kw): number {
  const n = kw.words.length;
  if (!n) return -1;
  for (let i = 0; i + n <= tokens.length; i++) {
    if (kw.start && i > 0) break;
    let ok = true;
    for (let j = 0; j < n && ok; j++) ok = wordIs(tokens[i + j]!, kw.words[j]!, kw.stem && j === n - 1, j === 0);
    if (ok) return i;
  }
  return -1;
}
interface Owner { dept: Dept; sub: Sub; kw: Kw }
const OWNERS: Owner[] = TAXONOMY.flatMap((dept) => dept.subs.flatMap((sub) => sub.kw.map((k) => ({ dept, sub, kw: parseKw(k) }))));
/** "בטעם לימון" / "בניחוח לבנדר" הוא טעם או ריח, לא המוצר */
const splitScripts = (s: string) => s.replace(/([א-ת])([0-9a-z])/g, "$1 $2").replace(/([0-9a-z])([א-ת])/g, "$1 $2");
const tokensOf = (name: string) => splitScripts(normalizeSearch(name)).replace(/(ללא|בלי|מופחת|דל|פחות) (תוספת )?סוכר/g, " ").split(/ (?:בטעם|בניחוח|לטעם|בתוספת|בריח|במילוי) /)[0]!.split(" ").filter(Boolean);

/** מילים כלליות בתחילת שם ("חטיף סניקרס", "משקה שוקו") — קובעות רק כשאין מילה ספציפית יותר אחריהן */
const WEAK = new Set(["חטיף", "חטיפי", "משקה", "משקאות"]);
/** מותגי טיפוח שמוכרים כמה סוגי מוצרים: מילת סוג מפורשת (שמפו, סבון, קרם, דאודורנט) קובעת; המותג קובע רק כשאין מילת סוג */
const BRAND = new Set(["פינוק", "פלמוליב", "פאלמוליב", "דאב", "ג'ילט", "לרפ", "פאיו", "קרליין", "וישי", "סבוקלם", "אוון", "וולדה", "ניוואה", "לוריאל"]);
const TYPE_DEPTS = new Set(["care", "cosmetics"]);
function best(tokens: string[], ok: (o: Owner) => boolean): Owner | null {
  const s = bestStrong(tokens, ok);
  if (s && BRAND.has(s.kw.raw)) return bestOf(tokens, (o) => ok(o) && !WEAK.has(o.kw.raw) && !BRAND.has(o.kw.raw) && TYPE_DEPTS.has(o.dept.id)) ?? s;
  return s;
}
function bestStrong(tokens: string[], ok: (o: Owner) => boolean): Owner | null {
  const strong = bestOf(tokens, (o) => ok(o) && !WEAK.has(o.kw.raw));
  const weak = bestOf(tokens, (o) => ok(o) && WEAK.has(o.kw.raw));
  return strong ?? weak;
}
// אינדקס לפי שתי האותיות הראשונות של מילת המפתח: בודקים רק מילים שיכולות להתאים לאחת המילים בשם
// (המילה עצמה, או אחרי אות שימוש אחת או שתיים)
const KEY = (s: string) => s.slice(0, 2);
const BY_KEY = new Map<string, number[]>();
OWNERS.forEach((o, i) => { const k = KEY(o.kw.words[0] ?? ""); (BY_KEY.get(k) ?? BY_KEY.set(k, []).get(k)!).push(i); });
function candidates(tokens: string[]): Owner[] {
  const idx = new Set<number>();
  for (const w of tokens) for (let off = 0; off <= 2 && off < w.length; off++) for (const k of [KEY(w.slice(off)), w.slice(off, off + 1)]) for (const i of BY_KEY.get(k) ?? []) idx.add(i);
  return [...idx].sort((a, b) => a - b).map((i) => OWNERS[i]!);
}
function bestOf(tokens: string[], ok: (o: Owner) => boolean): Owner | null {
  let b: Owner | null = null, bp = Infinity, bl = 0;
  for (const o of candidates(tokens)) {
    if (!ok(o)) continue;
    const p = find(tokens, o.kw);
    if (p < 0) continue;
    if (p < bp || (p === bp && o.kw.len > bl)) { b = o; bp = p; bl = o.kw.len; }
  }
  return b;
}
/** המחלקה ותת-המחלקה לפי השם, או null. מלכודות ("שוקולד חלב", "מרכך שיער") נפתרות כי המילה המוקדמת קובעת */
export function classify(name: string, skipDept?: string): { dept: Dept; sub: Sub | null; kw: string | null } | null {
  const n = normalizeSearch(name);
  if (NO_DEPT.test(n)) return null;
  const tokens = tokensOf(name);
  if (!PRE_RULE_SKIP.test(n)) for (const [re, dept] of PRE_RULES) if (re.test(n) && dept !== skipDept) {
    const d = TAXONOMY.find((x) => x.id === dept)!;
    const inner = best(tokens, (o) => o.dept.id === dept);
    // בלי מילה פנימית: בעלי חיים לפי כלב/חתול, תינוקות — טיפוח
    const fallback = dept === "pets" ? d.subs.find((s) => s.id === (/חתול|חתלתול|פנסי פיסט|fancy feast|פריסקיז|ויסקס|קיטיקט/.test(n) ? "cats" : /כלב/.test(n) ? "dogs" : "other"))
      : dept === "baby" ? d.subs.find((s) => s.id === (/מגבונ|מגבו(\s|$)|(^|\s)מג? ?האגיס|נייר טואלט לח/.test(n) ? "wipes" : /חיתול|האגיס|פמפרס|טיטול/.test(n) ? "diapers" : /חטיפ|מחית|דייסה/.test(n) ? "food" : "care"))
      : dept === "care" ? d.subs.find((s) => s.id === "hair") : null;
    // "לשיער" / "מרכך שיער" קובע: שיער, גם אם מופיעה קודם מילה כמו "קרם לחות"
    if (dept === "care") return { dept: d, sub: fallback ?? null, kw: inner?.kw.raw ?? null };
    // מגבונים של מותג חיתולים הם מגבונים
    const sub = (dept === "baby" && fallback?.id === "wipes") || (dept === "pets" && fallback?.id !== "other") ? fallback : inner?.sub ?? fallback;
    return { dept: d, sub: sub ?? null, kw: inner?.kw.raw ?? null };
  }
  const o = best(tokens, (x) => x.dept.id !== skipDept);
  if (!o) return null;
  // תת-קטגוריה עם החרגה (למשל "אטריות ביצים" אינן ביצים): עדיף להשאיר בלי שיוך מאשר לשייך לא נכון
  if (o.sub.exclude?.test(n)) {
    const alt = best(tokens, (x) => x.dept.id !== skipDept && x.sub !== o.sub);
    return alt && !alt.sub.exclude?.test(n) ? { dept: alt.dept, sub: alt.sub, kw: alt.kw.raw } : null;
  }
  return { dept: o.dept, sub: o.sub, kw: o.kw.raw };
}

/** קטגוריה לפי השם (המילה המוקדמת בשם קובעת) */
export function categoryOf(name: string): Category | null {
  const c = classify(name);
  return c ? CATEGORIES.find((x) => x.id === c.dept.id)! : null;
}
/** מילת המפתח שקבעה את הקטגוריה */
export function keywordOf(name: string): string | null { return classify(name)?.kw ?? null; }

/** תיקונים ידניים לפי ברקוד ("cat/sub", או "" = לא לשייך) */
const OVERRIDES: Record<string, string> = (overrides as { items: Record<string, string> }).items ?? {};

const FROZEN = /\s(סנפרוסט|קפוא|קפואה|קפואים|קפואות|מוקפא|מוקפאת|מוקפאים|מוקפאות)\s/;
/** שיוך מלא (מחלקה + תת-מחלקה) לייצוא ולדפדוף.
 *  "פירות וירקות" = תוצרת טרייה בלבד; מוצר מעובד ("עגבניות מרוסקות", "תרד קפוא") עובר למחלקה הבאה בתור */
export function placeOf(p: { name: string; manufacturer?: string | null; is_weighted?: boolean; unit_qty?: string | null; quantity?: number | null; barcode?: string }): { cat: string; sub: string } | null {
  if (p.barcode && Object.prototype.hasOwnProperty.call(OVERRIDES, p.barcode)) {
    const o = OVERRIDES[p.barcode]!;
    if (!o) return null;
    const [cat, sub] = o.split("/");
    return { cat: cat!, sub: sub ?? "" };
  }
  // דייסה עם מותג תינוקות או סימון גיל/שלב = מזון תינוקות
  if (/דייס/.test(p.name) && /(\+ ?\d|\d ?\+|שלב|חודש|לתינוק|לפעוט|מטרנה|סימילאק|נוטרילון|גרבר)/.test(p.name)) return { cat: "baby", sub: "food" };
  let c = classify(p.name);
  if (c?.dept.id === "produce") {
    const w = " " + splitScripts(normalizeSearch(p.name)) + " ";
    const tokens = tokensOf(p.name);
    const processed = /(מרוסק|כבוש|במלח| מלח |בחומץ|סחוט|מיובש|קפוא|ממרח|רסק|מרק|רוטב|חטיף|מטוגנ|פירה|שימורי|בסירופ|ריבה| מיץ|מחית|צ'יפס|ממולא|חתוכות|קצוצות|polpa|קלוי|מוקפא|על האש|בטחינה|במיונז|משקה|משחת|שעווה|מוגז|מסוכר|ציפס|טחונ|מטבוחה|אסלי|חומוס|מוחמצ|פיקנטי|בטעם כבד|מבושל|שיפקונית|שיפקה|מטוגן|גבישי|מיובש|אבקת|זרעי|צנצנ)/.test(w);
    const fresh = !!p.is_weighted || /^(ק"?ג|קג|קילו|קילוגרם|kg|יחידה|יחידות|יח)$/i.test(p.unit_qty ?? "") || /ארוז|מארז|סלסל|שקית|אורגני|בדץ|מהדרין|חסלט/.test(w);
    const startsFresh = !!c.kw && find(tokens, parseKw(c.kw)) === 0;
    void fresh;
    if ((c.sub?.id === "veg" || c.sub?.id === "fruit" || c.sub?.id === "herbs") && FROZEN.test(w)) return { cat: "frozen", sub: "veg" };
    if (!(startsFresh && !processed)) c = classify(p.name, "produce");
  }
  // שימורי ירקות/קטניות שכתוב עליהם "מוקפא" = ירקות קפואים
  if (c?.dept.id === "pantry" && (c.sub?.id === "cans" || c.sub?.id === "legumes" || c.sub?.id === "rice") && FROZEN.test(" " + splitScripts(normalizeSearch(p.name)) + " ")) return { cat: "frozen", sub: "veg" };
  let r = c ? { cat: c.dept.id, sub: c.sub?.id ?? "" } : null;
  const nm = normalizeSearch(p.name), mf = String(p.manufacturer ?? "");
  // ביטוי מטרה בכל השם ("... בניחוח לימון למדיח כלים") כשהשם המקוצר לא הכריע
  if (!r) { if (/למדיח/.test(nm)) r = { cat: "cleaning", sub: "dishes" }; else if (/להסרת איפור/.test(nm)) r = { cat: "care", sub: "skin" }; else if (/תרסיס אף/.test(nm)) r = { cat: "health", sub: "otc" }; }
  // דגים מעושנים/מלוחים/כבושים
  if (r?.cat === "meat" && r.sub === "fish" && /(^|\s)(מעושן|מעושנת|מומלח|מלוח|כבוש|קוויאר)(\s|$)/.test(nm)) r = { cat: "deli", sub: "smoked" };
  // יצרני גלידה: "קראנץ" של פרונרי/נסטלה הוא גלידה
  if ((!r || r.cat === "snacks" || r.cat === "dairy") && /פרונרי|גלידות נסטלה|גלידת שטראוס/.test(mf)) r = { cat: "frozen", sub: "icecream" };
  // חומוס של מפעל שימורים/אריזה הוא גרגירי חומוס, לא ממרח
  if (r?.cat === "deli" && r.sub === "hummus" && /זנלכל|יכין|סוגת|מיה תעשיות|פרי מבורך|בית יהודה|ויליפוד/.test(mf) && !/טחינה|סלט|מסעד|ממרח/.test(nm)) r = { cat: "pantry", sub: "legumes" };
  return veto(p, r);
}
/** תחום היצרן (מזון / לא-מזון) מהנתונים: יצרן ש-90% ממוצריו בתחום אחד. מוצר שנפל לתחום ההפוך עובר לתחום היצרן אם יש שם התאמה, אחרת בלי שיוך */
const MFR: Record<string, string> = mfrDomains as Record<string, string>;
const FOOD = new Set(["produce", "dairy", "deli", "meat", "frozen", "bakery", "pantry", "cooking", "breakfast", "snacks", "drinks", "coffee", "alcohol"]);
const isFood = (cat: string, sub: string) => FOOD.has(cat) || (cat === "baby" && sub === "food");
function veto(p: { name: string; manufacturer?: string | null }, r: { cat: string; sub: string } | null): { cat: string; sub: string } | null {
  const d = p.manufacturer ? MFR[String(p.manufacturer).trim()] : undefined;
  if (!d || d === "pets") return r;
  const wantFood = d === "food";
  if (!r) {
    // בלי שיוך: יקב = יין; רמז תחום בלבד, לא קובע מעבר לזה
    return /יקב/.test(String(p.manufacturer)) ? { cat: "alcohol", sub: "wine" } : null;
  }
  if (r.cat === "pets" || r.cat === "health" || isFood(r.cat, r.sub) === wantFood) return r;
  const o = best(tokensOf(p.name), (x) => isFood(x.dept.id, x.sub.id) === wantFood && x.dept.id !== "pets" && !x.sub.exclude?.test(normalizeSearch(p.name)));
  return o ? { cat: o.dept.id, sub: o.sub.id } : null;
}
export function shelfOf(p: { name: string; is_weighted: boolean; unit_qty?: string; quantity?: number | null; barcode?: string }): Category | null {
  const s = placeOf(p);
  return s ? CATEGORIES.find((x) => x.id === s.cat) ?? null : null;
}

/** תת-הקטגוריה של מוצר בתוך הקטגוריה שלו, או null */
export function subcategoryOf(catId: string, name: string): SubCategory | null {
  const c = classify(name);
  if (c?.dept.id === catId) return c.sub;
  return best(tokensOf(name), (o) => o.dept.id === catId)?.sub ?? null;
}

// ---------------------------------------------------------------- illustrations (legacy prefix matcher, unchanged)
const legacyWords = (name: string) => " " + normalizeSearch(name) + " ";
const legacyPos = (w: string, kw: string): number => {
  if (kw.startsWith("^")) { const p = legacyPos(w, kw.slice(1)); return p === 0 ? 0 : -1; }
  return kw.endsWith("$") ? w.indexOf(" " + normalizeSearch(kw.slice(0, -1)) + " ") : w.indexOf(" " + normalizeSearch(kw));
};
function earliestLegacy<T>(name: string, pairs: [string, T][]): T | null {
  const w = legacyWords(name);
  let b: T | null = null, bp = Infinity, bl = 0;
  for (const [k, v] of pairs) {
    const p = legacyPos(w, k);
    if (p < 0) continue;
    if (p < bp || (p === bp && k.length > bl)) { b = v; bp = p; bl = k.length; }
  }
  return b;
}
/** איור למוצר לפי מילה בשם. אם אף מילה לא מתאימה: שקית מצרכים כללית (לא איור קטגוריה שעלול להטעות) */
const ART: [string, string][] = [
  ["ביצים", "eggs"], ["יוגורט", "yogurt"], ["מעדן", "yogurt"], ["גבינ", "cheese"], ["קוטג", "cheese"], ["לבנה", "cheese"],
  ["חלב$", "milk"], ["לחם", "bread"], ["חלה", "bread"], ["פית", "bread"], ["לחמני", "bread"], ["עגבני", "tomato"], ["רסק", "can"],
  ["תפוח", "apple"], ["פסטה", "pasta"], ["ספגטי", "pasta"], ["קפה", "coffee"], ["שוקולד", "choc"], ["קולה", "cola"],
  ["משקה", "cola"], ["מים$", "water"], ["סודה", "water"], ["מיץ$", "juice"], ["נקטר", "juice"], ["סבון", "soap"],
  ["נוזל כלים", "soap"], ["אקונומיקה", "soap"], ["נייר טואלט", "tissue"], ["מגבונים", "tissue"], ["עוף", "drumstick"],
  ["שניצל", "drumstick"], ["פרגית", "drumstick"], ["תירס", "can"], ["שימורי", "can"], ["טונה", "can"], ["אורז$", "rice"],
  ["שמן$", "oil"], ["קמח$", "flour"], ["סוכר$", "sugar"], ["טחינה", "jar"], ["ממרח", "jar"], ["ריבה", "jar"], ["דבש", "jar"],
  ["ברוקולי", "broccoli"],
];
export const GENERIC_ART = "grocery";

/** שם קובץ האיור (בלי סיומת) למוצר */
export function artFor(name: string): string {
  return earliestLegacy(name, ART) ?? GENERIC_ART;
}

/** "סוג" המוצר לצורך חלופות: המילה הראשונה בשם המנורמל ("חלב 3% תנובה" → "חלב") */
export function productType(name: string): string {
  const first = normalizeSearch(name).split(" ")[0] ?? "";
  return first.length >= 2 && !/^\d/.test(first) ? first : "";
}

/** תנאי SQL גס (קבוצת-על) לקטגוריה; הסינון המדויק נעשה ב-categoryOf */
export function categoryWhere(c: Category, sqlString: (s: string) => string): string {
  return c.keywords
    .map((k) => `(' ' || search_key) LIKE ${sqlString((k.startsWith("^") ? " " : "% ") + normalizeSearch(k.replace(/^\^|\*$/g, "")) + "%")}`)
    .join(" OR ");
}
