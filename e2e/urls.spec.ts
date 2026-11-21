/**
 * כתובות האתר: כל דף נפתח ישירות מהכתובת, נשאר אחרי רענון, אחורה/קדימה עובדים,
 * קישורים ישנים עם "#/" מועברים, כתובת לא מוכרת מראה "הדף לא נמצא", וסל ששותף בקישור לא מחליף את הסל בשקט.
 */
import { expect, test, type Page } from "@playwright/test";

async function city(page: Page) {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.goto("./");
  await page.getByRole("combobox", { name: "שם העיר" }).fill("ירושל");
  await page.getByRole("option", { name: /ירושלים/ }).tap();
  await expect(page.getByRole("button", { name: /עיר: ירושלים/ })).toBeVisible();
}
const h1 = (page: Page) => page.getByRole("heading", { level: 1 });

const PAGES: [string, RegExp][] = [
  ["search?q=" + encodeURIComponent("חלב"), /חלב/],
  ["category/dairy", /חלב וביצים/],
  ["category/dairy/milk", /חלב וביצים · חלב/],
  ["product/9990000000125", /ביצים/],
  ["basket", /הסל שלי/],
  ["compare", /איפה לקנות/],
  ["plan", /איפה לקנות את כל הרשימה/],
  ["account", /החשבון שלי/],
  ["help", /איך זה עובד/],
];

test("כל כתובת נפתחת ישירות ונשארת אחרי רענון", async ({ page }) => {
  await city(page);
  for (const [path, title] of PAGES) {
    await page.goto("./" + path);
    await expect(h1(page)).toContainText(title);
    await page.reload();
    await expect(h1(page)).toContainText(title);
    expect(new URL(page.url()).pathname).toBe("/" + path.split("?")[0]);
  }
});

test("כתובות ישנות עם #/ עוברות לכתובת הנקייה", async ({ page }) => {
  await city(page);
  for (const [old, clean] of [["#/p/9990000000125", "/product/9990000000125"], ["#/cart", "/basket"], ["#/search?cat=dairy", "/category/dairy"], ["#/help", "/help"]]) {
    await page.goto("./" + old);
    await expect(page).toHaveURL(new RegExp(clean.replace(/\//g, "\\/") + "$"));
    expect(new URL(page.url()).hash).toBe("");
  }
});

test("כתובת לא מוכרת: דף 'לא נמצא' עם דרך חזרה", async ({ page }) => {
  await city(page);
  for (const path of ["nope", "category/nope", "category/dairy/nope", "product/!!"]) {
    await page.goto("./" + path);
    await expect(h1(page)).toHaveText("הדף לא נמצא");
  }
  await page.getByRole("link", { name: "לדף הבית" }).tap();
  await expect(page).toHaveURL(/\/$/);
});

test("אחורה וקדימה בתוך האפליקציה", async ({ page }) => {
  await city(page);
  await page.goto("./category/dairy");
  await expect(h1(page)).toContainText("חלב וביצים");
  await page.locator('.sub-chips a[href$="/category/dairy/milk"]').tap();
  await expect(page).toHaveURL(/\/category\/dairy\/milk$/);
  await page.goto("./help");
  await page.goBack();
  await expect(page).toHaveURL(/\/category\/dairy\/milk$/);
  await expect(h1(page)).toContainText("חלב וביצים · חלב");
  await page.goBack();
  await expect(page).toHaveURL(/\/category\/dairy$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/category\/dairy\/milk$/);
});

test("כתובת ישירה לפני בחירת עיר: אחרי הבחירה ממשיכים לדף שביקשו", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.goto("./product/9990000000125");
  await page.getByRole("combobox", { name: "שם העיר" }).fill("ירושל");
  await page.getByRole("option", { name: /ירושלים/ }).tap();
  await expect(h1(page)).toContainText("ביצים");
  await expect(page).toHaveURL(/\/product\/9990000000125$/);
});

test("סל ששותף בקישור: מוצג, ולא נכנס לסל בלי לחיצה", async ({ page }) => {
  await city(page);
  await page.goto("./basket?items=9990000000125*2");
  const shared = page.getByRole("region", { name: /סל ששותף איתך/ });
  await expect(shared).toContainText("ביצים");
  await expect(page.locator(".cart-row")).toHaveCount(0);
  await shared.getByRole("button", { name: "הוספה לסל שלי" }).tap();
  await expect(page.locator(".cart-row")).toHaveCount(1);
  await expect(page).toHaveURL(/\/basket$/);
});

test("עיר ושפה בקישור משותף", async ({ page }) => {
  await city(page);
  await page.goto("./help?lang=en&city=all");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: /City: Whole country/ })).toBeVisible();
  await expect(page).toHaveURL(/\/help$/);
});
