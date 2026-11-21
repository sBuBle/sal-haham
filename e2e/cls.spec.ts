/**
 * הדף לא קופץ בזמן הטעינה (CLS ≤ 0.05), גם בסדר הגרוע: הנתונים מגיעים באיחור,
 * והצעת ההתקנה (beforeinstallprompt) מגיעה אחרי שהדף כבר צויר. כך זה קרה ב-Lighthouse (CLS 0.92 על <main>).
 * Headless Chromium לא שולח beforeinstallprompt בעצמו, אז הבדיקה שולחת אחד, כמו שעושה Chrome כשהאתר ניתן להתקנה.
 */
import { expect, test, type Page } from "@playwright/test";

const LIMIT = 0.05;
const DELAY = 2500;

/** סופר את כל תזוזות הפריסה מתחילת הטעינה (בלי כאלה שבאו מיד אחרי קלט) */
async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__shifts = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) w.__shifts.push({ v: e.value, nodes: (e.sources ?? []).map((s: any) => s.node?.className || s.node?.nodeName) });
    }).observe({ type: "layout-shift", buffered: true });
  });
}
const total = (page: Page) => page.evaluate(() => (window as any).__shifts as { v: number; nodes: string[] }[]);

/** הצעת ההתקנה של Chrome, אחרי שהדף כבר מוצג */
const installOffer = (page: Page) =>
  page.evaluate(() => {
    const e: any = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = () => {};
    e.userChoice = Promise.resolve({ outcome: "dismissed" });
    dispatchEvent(e);
  });

/** כל קובצי הנתונים מגיעים באיחור */
const slowData = (page: Page) =>
  page.route(/\/data\//, async (r) => { await new Promise((ok) => setTimeout(ok, DELAY)); await r.continue(); });

async function chooseCity(page: Page) {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.goto("./");
  await page.getByRole("combobox", { name: "שם העיר" }).fill("ירושל");
  await page.getByRole("option", { name: /ירושלים/ }).click();
  await expect(page.getByRole("button", { name: /עיר: ירושלים/ })).toBeVisible();
}

async function expectStill(page: Page) {
  // נותנים לפריסה להתעדכן
  await page.waitForTimeout(800);
  const shifts = await total(page);
  const sum = shifts.reduce((s, x) => s + x.v, 0);
  expect(sum, `layout shifts: ${JSON.stringify(shifts)}`).toBeLessThanOrEqual(LIMIT);
}

const PHONE = {};
const PC = { viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

// ביקור חוזר עם נתונים מאוחרים: הדף, הקטגוריה והמוצר נטענים אל שלד בגודל הסופי, ושום דבר לא נדחף
const CASES: [string, object, string, string][] = [
  ["phone", PHONE, "category/dairy", "a[href*='/product/']"],
  ["phone", PHONE, "search?q=" + encodeURIComponent("חלב"), "a[href*='/product/']"],
  ["phone", PHONE, "product/9990000000125", "main h1"],
  ["pc", PC, "./", "main .home"],
  ["pc", PC, "category/dairy", "a[href*='/product/']"],
];

test.describe("בלי קפיצות בטעינה", () => {
  // בלי service worker, כדי שהעיכוב של page.route יחול על כל בקשה
  test.use({ serviceWorkers: "block" });

  test("הצעת ההתקנה אחרי הציור לא מזיזה את הדף (ביקור חוזר)", async ({ page }) => {
    await chooseCity(page);
    await watchShifts(page);
    await page.goto("category/dairy");
    await expect(page.locator("a[href*='/product/']").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await installOffer(page);
    await expect(page.getByRole("button", { name: /^התקנה$|^Install$/ })).toBeVisible();
    await expectStill(page);
  });

  // המקרה של Lighthouse (CLS 0.917): ביקור ראשון, רשימת הערים מגיעה באיחור, והצעת ההתקנה נכנסת באותו פריים שבו הרשימה
  // מחליפה את שורות הטעינה. הבאנר דחף את כל הדף 70px, והרשימה זרקה את "חיפוש בכל הארץ" מסך שלם למטה, באותו פריים.
  test("ביקור ראשון: רשימת הערים מאוחרת והצעת ההתקנה באותו פריים", async ({ page }) => {
    await page.goto("./");
    await page.evaluate(() => localStorage.clear());
    await watchShifts(page);
    await page.addInitScript(() => {
      const mo = new MutationObserver(() => {
        if (!document.querySelector(".city-grid")) return;
        mo.disconnect();
        const e: any = new Event("beforeinstallprompt", { cancelable: true });
        e.prompt = () => {};
        e.userChoice = Promise.resolve({ outcome: "dismissed" });
        dispatchEvent(e);
      });
      mo.observe(document, { childList: true, subtree: true });
    });
    await page.route(/\/data\/index\.json/, async (r) => { await new Promise((ok) => setTimeout(ok, DELAY)); await r.continue(); });
    await page.goto("./");
    await expect(page.locator(".city-grid")).toBeVisible({ timeout: 20_000 });
    await expectStill(page);
  });

  test("הצעת ההתקנה לא מופיעה מעל מסך בחירת העיר", async ({ page }) => {
    await page.goto("./");
    await page.evaluate(() => localStorage.clear());
    await watchShifts(page);
    await page.goto("./");
    await expect(page.locator(".city-grid")).toBeVisible({ timeout: 20_000 });
    await installOffer(page);
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: /^התקנה$|^Install$/ })).toHaveCount(0);
    await expectStill(page);
  });

  for (const [dev, use, path, ready] of CASES) {
    test.describe(dev, () => {
      test.use(use);
      test(`ביקור חוזר עם נתונים מאוחרים: ${decodeURIComponent(path)}`, async ({ page }) => {
        await chooseCity(page);
        await watchShifts(page);
        await slowData(page);
        await page.goto(path);
        await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 });
        // נותנים לכל מה שמגיע אחרי הנתונים (מחירים, מבצעים, חלופות) להגיע
        await page.waitForTimeout(2500);
        await expectStill(page);
      });
    });
  }
});

// מצבי הטעינה נגמרים גם כשאין מה להציג: חיפוש בלי תוצאות, ברקוד לא מוכר
test.describe("הטעינה לא נתקעת", () => {
  test.use({ serviceWorkers: "block" });
  for (const [name, path, text] of [
    ["חיפוש בלי תוצאות", "search?q=" + encodeURIComponent("זזזקקקווו"), /לא מצאנו/],
    ["ברקוד לא מוכר", "product/1234567890123", /לא מצאנו/],
  ] as const) {
    test(name, async ({ page }) => {
      await chooseCity(page);
      await slowData(page);
      await page.goto(path);
      await expect(page.locator("main")).toContainText(text, { timeout: 30_000 });
      await expect(page.locator("main .skeleton-list, main .skeleton-grid, main .city-loading")).toHaveCount(0);
    });
  }
});
