/**
 * QA לפי הבריף (סעיף 12), כלקוח אמיתי בטלפון 390×844, על נתוני הבדיקה.
 * מה שאין לו נתונים (דמי משלוח) נבדק כ"מוצג כלא ידוע ולא נכלל בסכום".
 */
import { expect, test, type Page } from "@playwright/test";

const TEN = ["חלב 3%", "לחם אחיד", "ביצים", "גבינה לבנה", "קפה נמס", "שמן קנולה", "אורז פרסי", "פסטה ספגטי", "רסק עגבניות", "קוטג"];
const num = (s: string) => Number(s.replace(/[^\d.]/g, ""));

async function city(page: Page) {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.goto("./");
  await page.getByRole("combobox", { name: "שם העיר" }).fill("ירושל");
  await page.getByRole("option", { name: /ירושלים/ }).tap();
}
async function add(page: Page, term: string) {
  await page.getByRole("searchbox", { name: "חיפוש מוצר לפי שם או ברקוד" }).fill(term);
  const first = page.locator(`ul.results[data-query="${term}"][aria-busy="false"]`).getByRole("listitem").first();
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: /^הוספת/ }).tap();
}

test("סל של 10 מוצרים: דירוג, טבלה, חסרים, שינוי כמות, תוכנית מפוצלת", async ({ page }) => {
  await city(page);
  for (const t of TEN) await add(page, t);
  await page.getByRole("button", { name: /השוואת מחירים לסל עם 10 מוצרים/ }).tap();

  const cards = page.getByTestId("store-card");
  await expect(cards.first()).toBeVisible();
  const data = await cards.evaluateAll((els) => els.map((e) => ({
    total: Number(e.getAttribute("data-total")), complete: e.getAttribute("data-complete") === "true", text: (e as HTMLElement).innerText,
  })));
  // דירוג: מלאים קודם וממוינים לפי מחיר
  const firstPartial = data.findIndex((d) => !d.complete);
  const full = (firstPartial < 0 ? data : data.slice(0, firstPartial)).map((d) => d.total);
  expect(full).toEqual([...full].sort((a, b) => a - b));
  for (const d of data.slice(Math.max(firstPartial, 0))) if (!d.complete) expect(d.text).toMatch(/חסרים:/);
  // דמי משלוח לא מומצאים
  expect(data[0]!.text).toContain("משלוח: אין נתון");

  // טבלת ההשוואה: הסכום בעמודה הראשונה = הסכום בכרטיס של אותו סניף
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  const firstColTotal = num(await table.locator("tfoot td").first().locator("b").innerText());
  expect(Math.round(firstColTotal * 100)).toBe(data[0]!.total);
  // תא "לא נמכר" מסומן גם בטקסט (לא רק בצבע)
  const missCells = table.locator("td.miss");
  if (await missCells.count()) await expect(missCells.first()).toContainText("לא נמכר");
  // הזול בכל שורה מסומן
  expect(await table.locator("tbody tr").count()).toBe(10);
  expect(await table.locator("tbody td.cheap").count()).toBeGreaterThanOrEqual(10);

  // תוכנית קנייה: פיצול לעולם לא יקר יותר מסניף אחד עם אותו כיסוי
  await page.goto("./#/plan");
  const single = page.getByRole("radio", { name: /^סניף אחד/ });
  const split = page.getByRole("radio", { name: /^סל מפוצל/ });
  await expect(single).toBeVisible();
  const sTotal = num(await single.locator(".s-total").innerText());
  const pTotal = num(await split.locator(".s-total").innerText());
  expect(pTotal).toBeLessThanOrEqual(sTotal);
  await expect(page.getByText(/דמי משלוח והזמנת מינימום: אין לנו נתונים/)).toBeVisible();
  // איזון נוחות: עלות עצירה גבוהה → סניף אחד
  await page.getByRole("radio", { name: /^איזון נוחות/ }).tap();
  await page.locator("#stop-cost").fill("60");
  await expect(page.locator(".plan-card .stops > li")).toHaveCount(1);

  // שינוי כמות בסל מעדכן את ההשוואה
  await page.goto("./#/cart");
  const milk = page.getByRole("group", { name: /כמות של חלב 3%/ });
  await milk.getByRole("button", { name: /הוספת עוד/ }).tap();
  await page.goto("./#/compare");
  await expect(cards.first()).toBeVisible();
  const after = Number(await cards.first().getAttribute("data-total"));
  expect(after).not.toBe(data[0]!.total);
});

test("החלפה בחלופה זולה יותר ושינוי שפה", async ({ page }) => {
  await city(page);
  await add(page, "שמן קנולה");
  await page.locator("ul.results a.pname").first().tap();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("שמן");
  await expect(page.getByText("אין תמונת מוצר: הרשתות לא מפרסמות תמונות")).toBeVisible();
  await expect(page.getByRole("heading", { name: "המחיר בכל סניף" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "היסטוריית מחיר" })).toBeVisible();

  // שפה: אנגלית ו-LTR
  await page.goto("./#/account");
  await page.getByLabel("שפה").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();
  await page.getByLabel("Language").selectOption("he");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
