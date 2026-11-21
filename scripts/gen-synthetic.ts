/**
 * נתוני בדיקה סינתטיים, מסומנים בבירור: שמות הרשתות כוללים "(נתוני בדיקה)", מזהי הרשת
 * מתחילים ב-999 (לא קיימים במציאות), ובכל קובץ יש <TestData>true</TestData> שגורם לאתר
 * להציג באנר "נתוני בדיקה".
 *
 * הקבצים מכסים את החריגות האמיתיות: UTF-8+BOM, UTF-16LE, windows-1255, קובץ .gz שהוא ZIP,
 * תגים באותיות גדולות (STOREID), קוד עיר מספרי, רווחים מיותרים, ItemType=0, מוצר שקיל.
 *
 * bun scripts/gen-synthetic.ts [outDir] [--updates]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import iconv from "iconv-lite";
import { zipSync } from "fflate";

export const TEST_CHAINS = {
  A: { id: "9990000000017", name: "רשת דמו א (נתוני בדיקה)" },
  B: { id: "9990000000024", name: "רשת דמו ב (נתוני בדיקה)" },
  C: { id: "9990000000031", name: "רשת דמו ג (נתוני בדיקה)" },
};

/** מוצרים גנריים; ברקודים פיקטיביים בתחילית 999 */
export const TEST_PRODUCTS: { code: string; name: string; mfr: string; qty: number; unit: string; uom: string; base: number; weighted?: boolean }[] = [
  { code: "9990000000101", name: "חלב 3% שומן", mfr: "מחלבת דמו", qty: 1, unit: "ליטר", uom: "ליטר", base: 690 },
  { code: "9990000000118", name: "לחם אחיד פרוס", mfr: "מאפיית דמו", qty: 750, unit: "גרם", uom: "100 גרם", base: 850 },
  { code: "9990000000125", name: "ביצים L תבנית 12", mfr: "משק דמו", qty: 12, unit: "יחידה", uom: "יחידה", base: 1390 },
  { code: "9990000000132", name: "גבינה לבנה 5%", mfr: "מחלבת דמו", qty: 250, unit: "גרם", uom: "100 גרם", base: 590 },
  { code: "9990000000149", name: "קפה נמס", mfr: "קלייית דמו", qty: 200, unit: "גרם", uom: "100 גרם", base: 2990 },
  { code: "9990000000156", name: "שמן קנולה", mfr: "בית בד דמו", qty: 1, unit: "ליטר", uom: "ליטר", base: 1190 },
  { code: "9990000000163", name: "אורז פרסי", mfr: "טחנת דמו", qty: 1, unit: "קילוגרם", uom: "100 גרם", base: 1290 },
  { code: "9990000000170", name: "פסטה ספגטי", mfr: "טחנת דמו", qty: 500, unit: "גרם", uom: "100 גרם", base: 590 },
  { code: "9990000000187", name: "רסק עגבניות", mfr: "שימורי דמו", qty: 100, unit: "גרם", uom: "100 גרם", base: 290 },
  { code: "9990000000194", name: "מים מינרליים 6 יח'", mfr: "מעיין דמו", qty: 9000, unit: "מיליליטר", uom: "100 מיליליטר", base: 1590 },
  { code: "9990000000200", name: "קוטג' 5%", mfr: "מחלבת דמו", qty: 250, unit: "גרם", uom: "100 גרם", base: 560 },
  { code: "9990000000217", name: "חומוס מוכן", mfr: "סלטי דמו", qty: 400, unit: "גרם", uom: "100 גרם", base: 990 },
  { code: "9990000000224", name: "טחינה גולמית", mfr: "סלטי דמו", qty: 500, unit: "גרם", uom: "100 גרם", base: 1890 },
  { code: "9990000000231", name: "שוקולד חלב", mfr: "ממתקי דמו", qty: 100, unit: "גרם", uom: "100 גרם", base: 690 },
  { code: "9990000000248", name: "נייר טואלט 32 גלילים", mfr: "ניירות דמו", qty: 32, unit: "יחידה", uom: "יחידה", base: 4990 },
  { code: "9990000000255", name: "סבון כלים", mfr: "ניקיון דמו", qty: 750, unit: "מיליליטר", uom: "100 מיליליטר", base: 990 },
  { code: "9990000000262", name: "קמח לבן", mfr: "טחנת דמו", qty: 1, unit: "קילוגרם", uom: "100 גרם", base: 590 },
  { code: "9990000000279", name: "סוכר לבן", mfr: "טחנת דמו", qty: 1, unit: "קילוגרם", uom: "100 גרם", base: 650 },
  { code: "9990000000286", name: "מיץ תפוזים טבעי", mfr: "פרדסי דמו", qty: 1.5, unit: "ליטר", uom: "ליטר", base: 1490 },
  { code: "9990000000293", name: "יוגורט ביו", mfr: "מחלבת דמו", qty: 150, unit: "גרם", uom: "100 גרם", base: 450 },
  { code: "0099900000309", name: "  חטיף   תירס  ", mfr: " ממתקי דמו ", qty: 70, unit: "גרם", uom: "100 גרם", base: 390 },
  { code: "100", name: "עגבניות שרי (שקיל)", mfr: "", qty: 1, unit: "קילוגרם", uom: "קילוגרם", base: 1290, weighted: true },
];

interface TestStore { chain: keyof typeof TEST_CHAINS; id: string; name: string; city: string; address: string }

/** שמות ערים נכתבים בכוונה בווריאציות כדי לבדוק נרמול */
export const TEST_STORES: TestStore[] = [
  { chain: "A", id: "001", name: "מרכז העיר", city: "3000", address: "רחוב הדוגמה 1" },
  { chain: "A", id: "002", name: "קניון דמו", city: "3000", address: "שדרות הניסוי 20" },
  { chain: "A", id: "003", name: "צפון", city: "5000", address: "דרך הבדיקה 5" },
  { chain: "B", id: "011", name: "שוק", city: "ירושלים", address: "רחוב הבדיקה 3" },
  { chain: "B", id: "012", name: "נמל", city: "תל אביב-יפו", address: "הנמל 1" },
  { chain: "B", id: "013", name: "דרום", city: "תל-אביב", address: "רחוב הדוגמה 9" },
  { chain: "B", id: "014", name: "אונו", city: "קריית אונו", address: "רחוב לוי 4" },
  { chain: "C", id: "21", name: "גבעה", city: "  ירושלים ", address: "הגבעה 7" },
  { chain: "C", id: "22", name: "סביון", city: "קרית-אונו", address: "רחוב סביון 2" },
];

const CHAIN_FACTOR: Record<string, number> = { A: 0.94, B: 1.0, C: 1.07 };

/** PRNG דטרמיניסטי */
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** האם המוצר נמכר בסניף. 10 המוצרים הראשונים בכל הסניפים, חוץ מחלב בסניף C-21 (כדי שיהיה סניף חלקי). */
export function sells(store: TestStore, pi: number): boolean {
  if (store.chain === "C" && store.id === "21" && pi === 0) return false;
  if (pi < 10) return true;
  if (TEST_PRODUCTS[pi]!.code === "100") return store.chain === "B";
  return rand(`${store.chain}${store.id}:${pi}`) > 0.2;
}

export function priceAg(store: TestStore, pi: number, bump = 0): number {
  const p = TEST_PRODUCTS[pi]!;
  const noise = 0.95 + rand(`${store.chain}${store.id}#${pi}`) * 0.1;
  return Math.round((p.base * CHAIN_FACTOR[store.chain]! * noise) / 10) * 10 + bump;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (t: string, v: string | number) => `<${t}>${esc(String(v))}</${t}>`;

function storesXml(chain: keyof typeof TEST_CHAINS): string {
  const c = TEST_CHAINS[chain];
  const stores = TEST_STORES.filter((s) => s.chain === chain);
  if (chain === "B") {
    // סגנון שופרסל: תגים באותיות גדולות ו-namespace
    return `<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values>` +
      tag("TESTDATA", "true") + tag("CHAINID", c.id) + `<STORES>` +
      stores.map((s) => `<STORE>${tag("CHAINID", c.id)}${tag("CHAINNAME", c.name)}${tag("SUBCHAINID", "1")}${tag("STOREID", s.id)}${tag("STORENAME", s.name)}${tag("ADDRESS", s.address)}${tag("CITY", s.city)}</STORE>`).join("") +
      `</STORES></asx:values></asx:abap>`;
  }
  return `<?xml version="1.0" encoding="${chain === "C" ? "windows-1255" : "utf-16"}"?><Root>` +
    tag("TestData", "true") + tag("ChainID", c.id) + tag("ChainName", c.name) +
    `<SubChains><SubChain>${tag("SubChainID", "001")}<Stores>` +
    stores.map((s) => `<Store>${tag("StoreID", s.id)}${tag("StoreName", s.name)}${tag("Address", s.address)}${tag("City", s.city)}</Store>`).join("") +
    `</Stores></SubChain></SubChains></Root>`;
}

function priceXml(store: TestStore, ts: string, opts: { only?: number[]; bump?: Record<number, number> } = {}): string {
  const c = TEST_CHAINS[store.chain];
  const items: string[] = [];
  TEST_PRODUCTS.forEach((p, pi) => {
    if (!sells(store, pi)) return;
    if (opts.only && !opts.only.includes(pi)) return;
    const price = priceAg(store, pi, opts.bump?.[pi] ?? 0);
    const internal = p.code === "100";
    const fields = {
      PriceUpdateDate: ts,
      ItemCode: p.code,
      ItemType: internal ? "0" : "1",
      ItemName: p.name,
      [store.chain === "B" ? "ManufacturerName" : "ManufactureName"]: p.mfr,
      Quantity: p.qty.toFixed(2),
      UnitQty: p.unit,
      UnitOfMeasure: p.uom,
      bIsWeighted: p.weighted ? "1" : "0",
      ItemPrice: (price / 100).toFixed(2),
    };
    const body = Object.entries(fields).map(([k, v]) => tag(store.chain === "B" ? k.toUpperCase() : k, v)).join("\n      ");
    items.push(store.chain === "B" ? `<ITEM>\n      ${body}\n    </ITEM>` : `<Item>\n      ${body}\n    </Item>`);
  });
  const enc = store.chain === "C" ? "windows-1255" : "utf-8";
  if (store.chain === "B") {
    return `<?xml version="1.0" encoding="utf-8"?>\n<root>${tag("TESTDATA", "true")}${tag("CHAINID", c.id)}${tag("STOREID", store.id)}\n  <ITEMS>\n    ${items.join("\n    ")}\n  </ITEMS>\n</root>`;
  }
  return `<?xml version="1.0" encoding="${enc}"?>\n<Root>${tag("TestData", "true")}${tag("ChainId", c.id)}${tag("SubChainId", "001")}${tag("StoreId", store.id)}\n  <Items Count="${items.length}">\n    ${items.join("\n    ")}\n  </Items>\n</Root>`;
}

/** מבצעי בדיקה לסניף (מבנה Promotion → Groups → Group → PromotionItems → PromotionItem, כמו בקבצים האמיתיים).
 *  תקפים מ-10 ימים לפני תאריך הקובץ ועד 2099, כדי שנתוני ההדגמה יציגו מבצעים בכל יום שבו בונים אותם. */
export interface TestPromo {
  id: string; desc: string;
  /** אינדקס ב-TEST_PRODUCTS */
  pi: number;
  /** price: המחיר ל-min יחידות הוא (מחיר רגיל × min) פחות off אגורות. free: "1+1". */
  kind: "price" | "free";
  min: number; off: number;
  club?: boolean; coupon?: boolean; expired?: boolean; limit?: number; minPurchase?: number;
}
export const TEST_PROMOS: Record<string, TestPromo[]> = {
  "A-001": [
    { id: "1001", desc: "חלב 3% שומן 2 במחיר מבצע", pi: 0, kind: "price", min: 2, off: 200 },
    { id: "1002", desc: "שמן קנולה במבצע מוגבל ל-3", pi: 5, kind: "price", min: 1, off: 300, limit: 3 },
    { id: "1003", desc: "קפה נמס לחברי מועדון", pi: 4, kind: "price", min: 1, off: 800, club: true },
    { id: "1004", desc: "פסטה ספגטי 1+1", pi: 7, kind: "free", min: 1, off: 0 },
    { id: "1005", desc: "קופון ביצים", pi: 2, kind: "price", min: 1, off: 500, coupon: true },
    { id: "1006", desc: "לחם אחיד מבצע שהסתיים", pi: 1, kind: "price", min: 1, off: 200, expired: true },
    { id: "1007", desc: "אורז פרסי בקנייה מעל 75", pi: 6, kind: "price", min: 1, off: 400, minPurchase: 75 },
  ],
  "B-011": [
    { id: "2001", desc: "גבינה לבנה 5% במבצע", pi: 3, kind: "price", min: 1, off: 100 },
  ],
};

export function promoXml(store: TestStore, date: string): string {
  const c = TEST_CHAINS[store.chain];
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 10);
  const from = start.toISOString().slice(0, 10);
  const promos = (TEST_PROMOS[`${store.chain}-${store.id}`] ?? []).map((p) => {
    const prod = TEST_PRODUCTS[p.pi]!;
    const price = priceAg(store, p.pi);
    const item = (rt: string, min: number, total: number | null, rate = "") => `<PromotionItem>${tag("ItemCode", prod.code)}${tag("ItemType", "1")}${tag("RewardType", rt)}${tag("MinQty", min)}<MaxQty/>${tag("DiscountRate", rate)}${total == null ? "<DiscountedPrice/>" : tag("DiscountedPrice", (total / 100).toFixed(2))}${tag("bIsWeighted", "0")}</PromotionItem>`;
    const group = (id: number, items: string, minPurchase = "0.00") => `<Group>${tag("GroupID", id)}${tag("MinPurchaseAmount", minPurchase)}<DiscountType/><PromotionItems>${items}</PromotionItems></Group>`;
    let groups: string;
    if (p.kind === "free") groups = group(1, item("0", p.min, null)) + group(2, item("10", 1, 0, "100.00"));
    else if (p.minPurchase) groups = group(1, `<PromotionItem>${tag("ItemCode", "0000000000000")}${tag("ItemType", "0")}${tag("RewardType", "0")}${tag("MinQty", 1)}</PromotionItem>`, p.minPurchase.toFixed(2)) + group(2, item("3", p.min, price * p.min - p.off), "");
    else groups = group(1, item(p.min > 1 ? "10" : "3", p.min, price * p.min - p.off));
    return `<Promotion>${tag("PromotionUpdateTime", `${from}T00:00:00.000`)}${tag("AllowMultipleDiscounts", "0")}${tag("PromotionID", p.id)}${tag("PromotionDescription", p.desc)}` +
      `${tag("PromotionStartDateTime", `${p.expired ? "2019-12-01" : from}T00:00:00.000`)}${tag("PromotionEndDateTime", `${p.expired ? "2020-01-01" : "2099-12-31"}T23:59:00.000`)}` +
      `<PromotionStartHour/><PromotionEndHour/><PromotionDays/>${p.limit ? tag("RedemptionLimit", p.limit) : "<RedemptionLimit/>"}${tag("MinNoOfItemOffered", "10")}` +
      `${tag("ClubID", p.club ? "(1=מועדון דמו)" : "0")}${tag("AdditionalIsCoupon", p.coupon ? "1" : "0")}<AdditionalRestrictions/><Remarks/><Groups>${groups}</Groups></Promotion>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?><Root>${tag("TestData", "true")}${tag("ChainID", c.id)}${tag("SubChainID", "001")}${tag("StoreID", store.id)}<Promotions>${promos.join("")}</Promotions></Root>`;
}

function encode(chain: string, xml: string, kind: "stores" | "prices"): Buffer {
  if (chain === "C") return iconv.encode(xml, "windows1255");
  if (chain === "A" && kind === "stores") return Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(xml, "utf16le")]);
  if (chain === "A") return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml, "utf8")]);
  return Buffer.from(xml, "utf8");
}

const stamp = (date: string, time: string) => ({ ymd: date.replace(/-/g, ""), hms: time.replace(/:/g, ""), ts: `${date} ${time}` });

export function writeSynthetic(outDir: string, opts: { date?: string; updates?: boolean } = {}): string[] {
  mkdirSync(outDir, { recursive: true });
  const date = opts.date ?? "2026-01-15";
  const files: string[] = [];
  const write = (name: string, data: Buffer | Uint8Array) => {
    const p = join(outDir, name);
    writeFileSync(p, data);
    files.push(p);
  };
  const t = stamp(date, "06:00:00");
  for (const ch of ["A", "B", "C"] as const) {
    const c = TEST_CHAINS[ch];
    const xml = storesXml(ch);
    const data = encode(ch, xml, "stores");
    if (ch === "A") write(`Stores${c.id}-000-${t.ymd}-${t.hms}.xml`, data); // UTF-16 לא דחוס, כמו רמי לוי
    else if (ch === "B") write(`Stores${c.id}-000-${t.ymd}${t.hms.slice(0, 4)}.gz`, gzipSync(data));
    else write(`Stores${c.id}-000-${t.ymd}-${t.hms}.gz`, zipSync({ [`Stores${c.id}.xml`]: data })); // ".gz" שהוא ZIP
  }
  for (const s of TEST_STORES) {
    const c = TEST_CHAINS[s.chain];
    const data = encode(s.chain, priceXml(s, t.ts), "prices");
    if (s.chain === "A") write(`PriceFull${c.id}-001-${s.id}-${t.ymd}-${t.hms}.gz`, gzipSync(data));
    else if (s.chain === "B") write(`PriceFull${c.id}-${s.id}-${t.ymd}${t.hms.slice(0, 4)}.gz`, gzipSync(data));
    else write(`PriceFull${c.id}-001-${s.id}-${t.ymd}-${t.hms}.gz`, zipSync({ [`PriceFull${c.id}-${s.id}.xml`]: data }));
  }
  for (const s of TEST_STORES) {
    if (!TEST_PROMOS[`${s.chain}-${s.id}`]) continue;
    const c = TEST_CHAINS[s.chain];
    write(`PromoFull${c.id}-001-${s.id}-${t.ymd}-${t.hms}.gz`, gzipSync(Buffer.from(promoXml(s, date), "utf8")));
  }
  if (opts.updates) {
    // עדכון חלקי: מוצר 0 עולה, מוצר 1 לא משתנה, מוצר 2 יורד
    const u = stamp(date, "14:00:00");
    const s = TEST_STORES[0]!;
    const c = TEST_CHAINS[s.chain];
    write(`Price${c.id}-001-${s.id}-${u.ymd}-${u.hms}.gz`, gzipSync(encode("A", priceXml(s, u.ts, { only: [0, 1, 2], bump: { 0: 50, 2: -40 } }), "prices")));
  }
  return files;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const out = args.find((a) => !a.startsWith("--")) ?? "tmp/synthetic";
  const files = writeSynthetic(out, { updates: args.includes("--updates") });
  console.log(`wrote ${files.length} synthetic TEST files → ${out}`);
}
