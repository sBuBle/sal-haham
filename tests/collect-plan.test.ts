/** אילו קבצים יורדים: דילוג על מה שכבר נטען, וקובצי עדכון במקום קובץ מלא */
import { describe, expect, test } from "bun:test";
import { planDownloads } from "../src/collect/plan.ts";
import { parseFileName } from "../src/ingest/filename.ts";

const C = "7290000000001";
const f = (name: string) => ({ name, meta: parseFileName(name)! });
const files = [
  // סניף 1: שני קבצים מלאים (אתמול והיום) ושני עדכונים אחרי המלא של היום, אחד לפניו
  `PriceFull${C}-001-001-20260114-060000.gz`,
  `PriceFull${C}-001-001-20260115-060000.gz`,
  `Price${C}-001-001-20260115-050000.gz`,
  `Price${C}-001-001-20260115-090000.gz`,
  `Price${C}-001-001-20260115-120000.gz`,
  `PromoFull${C}-001-001-20260115-061000.gz`,
  `Promo${C}-001-001-20260115-100000.gz`,
  // סניף 2
  `PriceFull${C}-001-002-20260115-060500.gz`,
  `PromoFull${C}-001-002-20260115-061500.gz`,
  // סניף 3: יש מבצעים אבל אין קובץ מחירים מלא ברשימה → לא נבחר
  `PromoFull${C}-001-003-20260115-061500.gz`,
  `Stores${C}-000-20260115-050000.gz`,
].map(f);
const names = (p: { get: { name: string }[] }) => p.get.map((x) => x.name.replace(C, "").replace(".gz", "")).sort();

describe("planDownloads", () => {
  test("מסד ריק: הקובץ המלא האחרון לכל סניף (מחירים ומבצעים), בלי עדכונים", () => {
    const p = planDownloads(files);
    expect(names(p)).toEqual(["PriceFull-001-001-20260115-060000", "PriceFull-001-002-20260115-060500", "PromoFull-001-001-20260115-061000", "PromoFull-001-002-20260115-061500"]);
    expect(p).toMatchObject({ stores: 2, skipped: 0, fulls: 4, deltas: 0 });
  });

  test("--updates: גם העדכונים שאחרי הקובץ המלא (לא אלה שלפניו)", () => {
    const p = planDownloads(files, { updates: true });
    expect(names(p)).toContain("Price-001-001-20260115-090000");
    expect(names(p)).toContain("Price-001-001-20260115-120000");
    expect(names(p)).toContain("Promo-001-001-20260115-100000");
    expect(names(p)).not.toContain("Price-001-001-20260115-050000");
    expect(p.deltas).toBe(3);
  });

  test("ריצה חוזרת: מה שנטען לא יורד; במקום הקובץ המלא יורדים רק העדכונים החדשים", () => {
    const loaded = new Set([
      `PriceFull${C}-001-001-20260115-060000.gz`, `PromoFull${C}-001-001-20260115-061000.gz`,
      `PriceFull${C}-001-002-20260115-060500.gz`, `PromoFull${C}-001-002-20260115-061500.gz`,
      `Price${C}-001-001-20260115-090000.gz`,
    ]);
    const p = planDownloads(files, { loaded });
    expect(names(p)).toEqual(["Price-001-001-20260115-120000", "Promo-001-001-20260115-100000"]);
    expect(p).toMatchObject({ skipped: 4, fulls: 0, deltas: 2 });
    // --no-deltas: שום דבר
    expect(planDownloads(files, { loaded, deltas: false }).get).toEqual([]);
  });

  test("קובץ מלא חדש יותר מזה שנטען → יורד (בלי העדכונים, שכבר כלולים בו)", () => {
    const loaded = new Set([`PriceFull${C}-001-001-20260114-060000.gz`]);
    const p = planDownloads(files, { loaded, promos: false });
    expect(names(p)).toEqual(["PriceFull-001-001-20260115-060000", "PriceFull-001-002-20260115-060500"]);
  });

  test("סינון סניפים, מגבלת סניפים, רק מבצעים, בלי מבצעים", () => {
    expect(names(planDownloads(files, { storeIds: new Set(["2"]) }))).toEqual(["PriceFull-001-002-20260115-060500", "PromoFull-001-002-20260115-061500"]);
    expect(planDownloads(files, { maxStores: 1 }).stores).toBe(1);
    expect(names(planDownloads(files, { promosOnly: true }))).toEqual(["PromoFull-001-001-20260115-061000", "PromoFull-001-002-20260115-061500"]);
    expect(names(planDownloads(files, { promos: false }))).toEqual(["PriceFull-001-001-20260115-060000", "PriceFull-001-002-20260115-060500"]);
  });
});
