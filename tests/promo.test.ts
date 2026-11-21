/** מבצעים: פענוח קובצי Promo, כללי "מה נחשב מבצע", טעינה (PromoFull / Promo), ייצוא וחישוב מחיר שורה */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { DuckDBInstance } from "@duckdb/node-api";
import { PriceDb } from "../src/ingest/db.ts";
import { parsePromos, promoRows, isClub, endDate, type RawPromo } from "../src/ingest/promo.ts";
import { applyDeals, bestDeals, dealLine, dealKey, type Deal, type PromoRow } from "../src/shared/promo.ts";
import { rankStores } from "../src/shared/ranking.ts";
import { writeSynthetic, TEST_CHAINS, TEST_STORES, priceAg } from "../scripts/gen-synthetic.ts";
import { ingestPaths } from "../src/ingest/cli.ts";
import { exportSite, type SiteIndex } from "../src/ingest/export.ts";

const CHAIN = "7290000000001";

async function* text(s: string) { yield s; }
async function parse(xml: string): Promise<RawPromo[]> {
  const out: RawPromo[] = [];
  await parsePromos(text(xml), (p) => out.push(p));
  return out;
}

interface P {
  id?: string; desc?: string; club?: string; coupon?: string; days?: string; limit?: string; end?: string; start?: string;
  groups: { minPurchase?: string; items: { code: string; type?: string; rt: string; min?: string; max?: string; rate?: string; price?: string; w?: string }[] }[];
}
const promoXml = (ps: P[]) => `<Root><ChainID>${CHAIN}</ChainID><SubChainID>001</SubChainID><StoreID>001</StoreID><Promotions>` + ps.map((p, i) =>
  `<Promotion><PromotionID>${p.id ?? String(i + 1)}</PromotionID><PromotionDescription>${p.desc ?? "מבצע " + (i + 1)}</PromotionDescription>` +
  `<PromotionStartDateTime>${p.start ?? "2026-01-01T00:00:00.000"}</PromotionStartDateTime><PromotionEndDateTime>${p.end ?? "2026-12-31T23:59:00.000"}</PromotionEndDateTime>` +
  `<PromotionDays>${p.days ?? ""}</PromotionDays><RedemptionLimit>${p.limit ?? ""}</RedemptionLimit><ClubID>${p.club ?? "0"}</ClubID><AdditionalIsCoupon>${p.coupon ?? "0"}</AdditionalIsCoupon><Remarks/>` +
  `<Groups>` + p.groups.map((g, gi) => `<Group><GroupID>${gi + 1}</GroupID><MinPurchaseAmount>${g.minPurchase ?? "0.00"}</MinPurchaseAmount><DiscountType/><PromotionItems>` +
    g.items.map((it) => `<PromotionItem><ItemCode>${it.code}</ItemCode><ItemType>${it.type ?? "1"}</ItemType><RewardType>${it.rt}</RewardType><MinQty>${it.min ?? "1"}</MinQty><MaxQty>${it.max ?? ""}</MaxQty>` +
      `<DiscountRate>${it.rate ?? ""}</DiscountRate><DiscountedPrice>${it.price ?? ""}</DiscountedPrice><bIsWeighted>${it.w ?? "0"}</bIsWeighted></PromotionItem>`).join("") +
    `</PromotionItems></Group>`).join("") + `</Groups></Promotion>`).join("") + `</Promotions></Root>`;

const rows = async (ps: P[]) => (await parse(promoXml(ps))).flatMap((p) => promoRows(p, CHAIN));

describe("פענוח קובץ מבצעים", () => {
  test("מבנה Groups: שדות המבצע, הקבוצות והפריטים", async () => {
    const [p] = await parse(promoXml([{ desc: "במבה 2 ב-10", groups: [{ items: [{ code: "111", rt: "10", min: "2", price: "10.00" }, { code: "222", rt: "10", min: "2", price: "10.00" }] }] }]));
    expect(p!.fields["promotiondescription"]).toBe("במבה 2 ב-10");
    expect(p!.groups.length).toBe(1);
    expect(p!.groups[0]!.items.map((i) => i["itemcode"])).toEqual(["111", "222"]);
  });

  test("מבנה ישן: פריטים ישירות תחת המבצע, שדות ההטבה ברמת המבצע, כמה ClubId", async () => {
    const xml = `<root><ChainId>${CHAIN}</ChainId><StoreId>5</StoreId><Promotions><Promotion><PromotionId>9</PromotionId><PromotionDescription>חלב 2 ב-12</PromotionDescription>
      <PromotionStartDate>2026-01-01</PromotionStartDate><PromotionEndDate>2026-12-31</PromotionEndDate><RewardType>1</RewardType><MinQty>2.00</MinQty><DiscountedPrice>12.00</DiscountedPrice>
      <AdditionalRestrictions><AdditionalIsCoupon>0</AdditionalIsCoupon></AdditionalRestrictions><Clubs><ClubId>0</ClubId></Clubs>
      <PromotionItems Count="2"><Item><ItemCode>111</ItemCode><ItemType>1</ItemType><IsGiftItem>0</IsGiftItem></Item><Item><ItemCode>222</ItemCode><ItemType>1</ItemType></Item></PromotionItems></Promotion></Promotions></root>`;
    const [p] = await parse(xml);
    const r = promoRows(p!, CHAIN);
    expect(r.map((x) => [x.barcode, x.min_qty, x.total_ag, x.club])).toEqual([["111", 2, 1200, false], ["222", 2, 1200, false]]);
    expect(r[0]!.end_date).toBe("2026-12-31");
  });
});

describe("מה נחשב מבצע", () => {
  test("מחיר מבצע ליחידה, 'N ב-X', ומגבלת מימושים", async () => {
    const r = await rows([
      { groups: [{ items: [{ code: "111", rt: "3", min: "1", price: "9.90" }] }] },
      { limit: "2", groups: [{ items: [{ code: "222", rt: "10", min: "2", price: "24.00" }] }] },
    ]);
    expect(r.map((x) => [x.barcode, x.kind, x.min_qty, x.total_ag, x.max_qty])).toEqual([["111", "price", 1, 990, null], ["222", "price", 2, 2400, 4]]);
  });

  test("שקיל: MinQty=0.01 → מחיר לק\"ג, המגבלה בק\"ג", async () => {
    const r = await rows([{ limit: "3", groups: [{ items: [{ code: "333", rt: "10", min: "0.010", max: "3", price: "34.90", w: "1" }] }] }]);
    expect(r.map((x) => [x.min_qty, x.total_ag, x.max_qty])).toEqual([[1, 3490, 3]]);
  });

  test("קוד פנימי של רשת (ItemType=0) מקבל את אותו מפתח כמו בקובץ המחירים", async () => {
    const r = await rows([{ groups: [{ items: [{ code: "0055", type: "0", rt: "3", price: "5.00" }] }] }]);
    expect(r[0]!.barcode).toBe(`${CHAIN}:55`);
  });

  test("קופון, מתנה, הטבת מצטרפים, 'תו זהב' וימים מסוימים — לא מבצע", async () => {
    const item = { code: "111", rt: "3", price: "9.90" };
    expect(await rows([{ coupon: "1", groups: [{ items: [item] }] }])).toEqual([]);
    expect(await rows([{ desc: "קופון פיצוי לקוח", groups: [{ items: [item] }] }])).toEqual([]);
    expect(await rows([{ desc: "עוגה ב9.90 מצטרפים", groups: [{ items: [item] }] }])).toEqual([]);
    expect(await rows([{ desc: "תו זהב 5% הנחה", groups: [{ items: [item] }] }])).toEqual([]);
    expect(await rows([{ days: "1,2,3,4,5", groups: [{ items: [item] }] }])).toEqual([]);
    expect((await rows([{ days: "1,2,3,4,5,6,7", groups: [{ items: [item] }] }])).length).toBe(1);
    expect(await rows([{ groups: [{ items: [{ code: "111", rt: "2", rate: "100.00", price: "0.00" }] }] }])).toEqual([]);
  });

  test("מועדון: '0' ו-'0 - כלל הלקוחות' לכולם; כל ערך אחר — מועדון", () => {
    expect(isClub("0")).toBe(false);
    expect(isClub("")).toBe(false);
    expect(isClub("0 - כלל הלקוחות")).toBe(false);
    expect(isClub("0=אין")).toBe(false);
    expect(isClub("2=לייף סטייל")).toBe(true);
    expect(isClub("1=")).toBe(true);
    expect(isClub("(3=פלטינום)")).toBe(true);
    expect(isClub("1=Yellow friends")).toBe(true);
    expect(isClub("(0=מועדון קרפור אשראי|0=מועדון אפליקציה)")).toBe(true);
    expect(isClub("2 - מועדון אשראי של הקמעונאי")).toBe(true);
  });

  test("'בקנייה מעל 75': בקבוצת הפריטים או בקבוצה נפרדת עם קוד 0000000000000", async () => {
    const a = await rows([{ groups: [{ minPurchase: "75.00", items: [{ code: "111", rt: "10", price: "34.90" }] }] }]);
    const b = await rows([{ groups: [{ minPurchase: "75.00", items: [{ code: "0000000000000", type: "0", rt: "0" }] }, { minPurchase: "", items: [{ code: "111", rt: "3", price: "13.30" }] }] }]);
    expect(a.map((x) => x.min_purchase_ag)).toEqual([7500]);
    expect(b.map((x) => [x.barcode, x.total_ag, x.min_purchase_ag])).toEqual([["111", 1330, 7500]]);
  });

  test("'1+1' ו-'2+1': קבוצת תנאי וקבוצת הטבה ב-100% על אותם פריטים", async () => {
    const r = await rows([
      { groups: [{ items: [{ code: "111", rt: "0", min: "1" }] }, { items: [{ code: "111", rt: "1", min: "1", rate: "100.00", price: "0.00" }] }] },
      { groups: [{ items: [{ code: "222", rt: "0", min: "2" }, { code: "223", rt: "0", min: "2" }] }, { items: [{ code: "222", rt: "10", min: "1", rate: "100.00", price: "0.00" }, { code: "999", rt: "10", min: "1", rate: "100.00", price: "0.00" }] }] },
    ]);
    // 999 אינו בקבוצת התנאי → לא נכלל
    expect(r.map((x) => [x.barcode, x.kind, x.min_qty, x.free_qty])).toEqual([["111", "free", 2, 1], ["222", "free", 3, 1]]);
  });

  test("מבצע שתלוי בפריטים אחרים ('הגדלת סל', דיל של כריך + שתייה) — לא נכלל", async () => {
    // תנאי: 3 פריטים כלשהם (קוד 0) בלי סכום
    expect(await rows([{ groups: [{ minPurchase: "", items: [{ code: "0000000000000", type: "0", rt: "0", min: "3" }] }, { items: [{ code: "111", rt: "10", min: "2", price: "12.00" }] }] }])).toEqual([]);
    // שתי קבוצות הטבה
    expect(await rows([{ groups: [{ items: [{ code: "111", rt: "10", price: "5.94" }] }, { items: [{ code: "222", rt: "10", price: "5.94" }] }] }])).toEqual([]);
    // תנאי על פריט אחר והטבה שאינה חינם
    expect(await rows([{ groups: [{ items: [{ code: "111", rt: "0", min: "1", price: "39.90" }] }, { items: [{ code: "222", rt: "10", price: "32.90" }] }] }])).toEqual([]);
  });

  test("היום האחרון: 23:59 → אותו יום; 00:00 → אותו יום; 02:59 (שופרסל) → היום הקודם", () => {
    expect(endDate("2026-12-05T23:59:00.000")).toBe("2026-12-05");
    expect(endDate("2026-11-30T00:00:00.000")).toBe("2026-11-30");
    expect(endDate("2026-11-28T02:59:00.000")).toBe("2026-11-27");
    expect(endDate("2027-01-01T02:59:00.000")).toBe("2026-12-31");
  });
});

describe("טעינה: PromoFull מחליף, Promo מעדכן, קובץ ישן לא דורס", () => {
  let dir: string;
  let db: PriceDb;
  const file = (name: string, ps: P[]) => { const p = join(dir, name); writeFileSync(p, gzipSync(Buffer.from(promoXml(ps)))); return p; };
  const list = () => db.all<{ promo_id: string; barcode: string; total_ag: number }>(`SELECT promo_id, barcode, total_ag FROM promos ORDER BY promo_id, barcode`);
  beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "salpromo-")); db = await PriceDb.open(":memory:"); });
  afterAll(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

  test("PromoFull → שורה לכל פריט; קובץ מלא חדש מחליף הכול", async () => {
    const one = { groups: [{ items: [{ code: "111", rt: "3", price: "9.90" }, { code: "112", rt: "3", price: "9.90" }] }] };
    const r = await db.ingestFile(file(`PromoFull${CHAIN}-001-001-20260110-060000.gz`, [{ id: "1", ...one }, { id: "2", groups: [{ items: [{ code: "222", rt: "10", min: "2", price: "24.00" }] }] }]));
    expect(r.status).toBe("loaded");
    expect(r.rows).toBe(3);
    expect(await list()).toEqual([{ promo_id: "1", barcode: "111", total_ag: 990 }, { promo_id: "1", barcode: "112", total_ag: 990 }, { promo_id: "2", barcode: "222", total_ag: 2400 }]);
    await db.ingestFile(file(`PromoFull${CHAIN}-001-001-20260111-060000.gz`, [{ id: "2", groups: [{ items: [{ code: "222", rt: "10", min: "2", price: "22.00" }] }] }]));
    expect(await list()).toEqual([{ promo_id: "2", barcode: "222", total_ag: 2200 }]);
  });

  test("Promo (עדכון) מחליף רק את המבצעים שבו, כולל מבצע שהפך ללא-מבצע", async () => {
    await db.ingestFile(file(`Promo${CHAIN}-001-001-20260111-120000.gz`, [
      { id: "3", groups: [{ items: [{ code: "333", rt: "3", price: "5.00" }] }] },
      { id: "2", coupon: "1", groups: [{ items: [{ code: "222", rt: "10", min: "2", price: "22.00" }] }] },
    ]));
    expect(await list()).toEqual([{ promo_id: "3", barcode: "333", total_ag: 500 }]);
  });

  test("PromoFull ישן שמגיע אחרי חדש לא דורס; אותו קובץ פעמיים מדולג", async () => {
    const old = file(`PromoFull${CHAIN}-001-001-20260105-060000.gz`, [{ id: "7", groups: [{ items: [{ code: "777", rt: "3", price: "7.00" }] }] }]);
    expect((await db.ingestFile(old)).status).toBe("loaded");
    expect(await list()).toEqual([{ promo_id: "3", barcode: "333", total_ag: 500 }]);
    expect((await db.ingestFile(old)).status).toBe("skipped-duplicate");
  });
});

describe("מחיר שורה עם מבצע", () => {
  const deal = (d: Partial<Deal>): Deal => ({ club: false, min_qty: 1, total_ag: 0, max_qty: null, min_purchase_ag: null, ends: "2099-12-31", descr: "", ...d });

  test("מחיר מבצע ליחידה חל על כל כמות", () => {
    expect(dealLine(1290, 1, deal({ total_ag: 990 }))).toBe(990);
    expect(dealLine(1290, 3, deal({ total_ag: 990 }))).toBe(2970);
  });

  test("'2 ב-24': יחידה אחת במחיר רגיל, 3 יחידות = מבצע + יחידה רגילה", () => {
    const d = deal({ min_qty: 2, total_ag: 2400 });
    expect(dealLine(1490, 1, d)).toBeNull();
    expect(dealLine(1490, 2, d)).toBe(2400);
    expect(dealLine(1490, 3, d)).toBe(2400 + 1490);
    expect(dealLine(1490, 4, d)).toBe(4800);
  });

  test("מגבלה: 'מוגבל ל-3' — היחידה הרביעית במחיר רגיל", () => {
    expect(dealLine(1000, 5, deal({ total_ag: 700, max_qty: 3 }))).toBe(3 * 700 + 2 * 1000);
    expect(dealLine(1000, 5, deal({ min_qty: 2, total_ag: 1500, max_qty: 2 }))).toBe(1500 + 3 * 1000);
  });

  test("מבצע שאינו זול מהמחיר הרגיל לא חל", () => {
    expect(dealLine(500, 2, deal({ min_qty: 2, total_ag: 1000 }))).toBeNull();
  });

  const stores = [{ chain_id: "A", store_id: "1", chain_name: "א", store_name: "1" }, { chain_id: "B", store_id: "1", chain_name: "ב", store_name: "1" }];
  const prices = [
    { barcode: "milk", chain_id: "A", store_id: "1", price_ag: 700 }, { barcode: "milk", chain_id: "B", store_id: "1", price_ag: 650 },
    { barcode: "rice", chain_id: "A", store_id: "1", price_ag: 1200 }, { barcode: "rice", chain_id: "B", store_id: "1", price_ag: 1200 },
  ];
  const promo = (p: Partial<PromoRow>): PromoRow => ({ ...deal({}), barcode: "milk", chain_id: "A", store_id: "1", ...p });

  test("applyDeals: הדירוג מתהפך כשהמבצע חל על הכמות שבסל, והסכום מדויק", () => {
    const promos = [promo({ min_qty: 2, total_ag: 1000 })];
    const one = [{ barcode: "milk", qty: 1 }, { barcode: "rice", qty: 1 }];
    const two = [{ barcode: "milk", qty: 3 }, { barcode: "rice", qty: 1 }];
    // יחידה אחת: המבצע לא חל, ב' זול יותר
    const a1 = applyDeals(prices, promos, one);
    expect(a1.applied.size).toBe(0);
    expect(rankStores(one, stores, a1.prices)[0]!.store.chain_id).toBe("B");
    // 3 יחידות: 2 במבצע (1000) + 1 רגילה (700) + אורז 1200 = 2900 מול 650×3+1200 = 3150
    const a2 = applyDeals(prices, promos, two);
    const r = rankStores(two, stores, a2.prices);
    expect(r.map((x) => [x.store.chain_id, x.total_ag])).toEqual([["A", 2900], ["B", 3150]]);
    expect(a2.applied.get(dealKey("A", "1", "milk"))).toMatchObject({ regular_ag: 700, line_ag: 1700, saved_ag: 400 });
    // המחירים המקוריים לא שונו
    expect(prices[0]!.price_ag).toBe(700);
  });

  test("applyDeals: מבצע מועדון רק כשביקשו; מבצע שהסתיים לא חל", () => {
    const basket = [{ barcode: "milk", qty: 1 }];
    const club = [promo({ club: true, total_ag: 500 })];
    expect(applyDeals(prices, club, basket).applied.size).toBe(0);
    expect(applyDeals(prices, club, basket, { club: true }).applied.size).toBe(1);
    expect(applyDeals(prices, [promo({ total_ag: 500, ends: "2026-01-01" })], basket, { today: "2026-01-02" }).applied.size).toBe(0);
    expect(applyDeals(prices, [promo({ total_ag: 500, ends: "2026-01-02" })], basket, { today: "2026-01-02" }).applied.size).toBe(1);
  });

  test("applyDeals: 'בקנייה מעל X' חל רק כששאר הסל בסניף מגיע לסכום", () => {
    const promos = [promo({ total_ag: 500, min_purchase_ag: 2000 })];
    expect(applyDeals(prices, promos, [{ barcode: "milk", qty: 1 }, { barcode: "rice", qty: 1 }]).applied.size).toBe(0);
    expect(applyDeals(prices, promos, [{ barcode: "milk", qty: 1 }, { barcode: "rice", qty: 2 }]).applied.size).toBe(1);
  });

  test("bestDeals: הזול לכל הלקוחות והזול למועדון, בנפרד", () => {
    const m = bestDeals([promo({ total_ag: 600 }), promo({ min_qty: 2, total_ag: 1000 }), promo({ club: true, total_ag: 450 })]);
    const e = m.get(dealKey("A", "1", "milk"))!;
    expect(e.open!.total_ag).toBe(1000);
    expect(e.club!.total_ag).toBe(450);
  });
});

describe("ייצוא מבצעים (נתוני הבדיקה הסינתטיים)", () => {
  let dir: string;
  let index: SiteIndex;
  const A1 = TEST_STORES[0]!;
  const q = async (sql: string) => {
    const inst = await DuckDBInstance.create(":memory:");
    const con = await inst.connect();
    const r = (await con.runAndReadAll(sql)).getRowObjectsJson();
    con.closeSync(); inst.closeSync();
    return r as any[];
  };
  const pq = (rel: string) => join(dir, "site", rel).replace(/\\/g, "/");
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "salpromoexp-"));
    writeSynthetic(join(dir, "raw"), { updates: true });
    await ingestPaths([join(dir, "raw")], { db: join(dir, "db.duckdb") });
    index = await exportSite(join(dir, "db.duckdb"), join(dir, "site"), { now: "2026-01-15 12:00:00" });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("promos.parquet: מבצעים תקפים בלבד, עם התנאים; קופון ומבצע שהסתיים לא מיוצאים", async () => {
    const r = await q(`SELECT barcode, club, min_qty, total_ag, max_qty, min_purchase_ag, ends FROM '${pq("all/promos.parquet")}' WHERE chain_id = '${TEST_CHAINS.A.id}' AND store_id = '1' ORDER BY barcode`);
    const by = Object.fromEntries(r.map((x) => [x.barcode, x]));
    expect(Object.keys(by).sort()).toEqual(["9990000000101", "9990000000149", "9990000000156", "9990000000163", "9990000000170"]);
    expect(by["9990000000101"]).toMatchObject({ club: false, min_qty: 2, total_ag: priceAg(A1, 0) * 2 - 200, ends: "2099-12-31" });
    expect(by["9990000000156"]).toMatchObject({ min_qty: 1, total_ag: priceAg(A1, 5) - 300, max_qty: 3 });
    expect(by["9990000000149"]).toMatchObject({ club: true, total_ag: priceAg(A1, 4) - 800 });
    // 1+1: שתי יחידות במחיר של אחת
    expect(by["9990000000170"]).toMatchObject({ min_qty: 2, total_ag: priceAg(A1, 7) });
    expect(by["9990000000163"]).toMatchObject({ min_purchase_ag: 7500 });
    expect(index.totals.promos).toBe(6);
  });

  test("products.parquet: deal_ag = המחיר הנמוך ליחידה במבצע לכל הלקוחות בלי תנאי; מועדון ב-club_ag", async () => {
    const slug = index.cities.find((c) => c.key === "ירושלים")!.slug;
    const r = await q(`SELECT barcode, deal_ag, deal_qty, deal_total_ag, club_ag, n_deals FROM '${pq(`cities/${slug}/products.parquet`)}' WHERE n_deals > 0 ORDER BY barcode`);
    const by = Object.fromEntries(r.map((x) => [x.barcode, x]));
    expect(by["9990000000101"]).toMatchObject({ deal_ag: priceAg(A1, 0) - 100, deal_qty: 2, deal_total_ag: priceAg(A1, 0) * 2 - 200, club_ag: null, n_deals: 1 });
    expect(by["9990000000149"]).toMatchObject({ deal_ag: null, club_ag: priceAg(A1, 4) - 800 });
    // מבצע עם תנאי קנייה לא קובע את מחיר הכרטיס, אבל נספר
    expect(by["9990000000163"]).toMatchObject({ deal_ag: null, n_deals: 1 });
    // מוצר בלי מבצע: עמודות ריקות
    const none = await q(`SELECT deal_ag, n_deals FROM '${pq(`cities/${slug}/products.parquet`)}' WHERE barcode = '9990000000125'`);
    expect(none).toEqual([{ deal_ag: null, n_deals: 0 }]);
  });

  test("מבצע שעוד לא התחיל לא מיוצא", async () => {
    const idx = await exportSite(join(dir, "db.duckdb"), join(dir, "site2"), { now: "2025-12-01 12:00:00" });
    expect(idx.totals.promos).toBe(0);
  });
});
