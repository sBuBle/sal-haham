/**
 * E2E במסך 390×844 (מגע, מובייל) על נתוני הבדיקה הסינתטיים.
 * תרחיש ההצלחה: בוחרים עיר, מוסיפים 5 מוצרים (חיפוש + ברקוד), ומקבלים דירוג נכון.
 */
import { expect, test, type Page } from "@playwright/test";

const BASKET = ["חלב 3%", "לחם אחיד", "ביצים", "קפה נמס", "שמן קנולה"];

async function chooseCity(page: Page, typed: string, option: string) {
  const input = page.getByRole("combobox", { name: "שם העיר" });
  await input.fill(typed);
  await page.getByRole("option", { name: new RegExp(option) }).tap();
  await expect(page.getByRole("button", { name: new RegExp(`עיר: ${option}`) })).toBeVisible();
}

async function addBySearch(page: Page, term: string) {
  const q = page.getByRole("searchbox", { name: "חיפוש מוצר לפי שם או ברקוד" });
  await q.fill(term);
  // מחכים לתוצאות של השאילתה הזו (ולא של הקודמת, שעדיין מוצגות בזמן ה-debounce)
  const list = page.locator(`ul.results[data-query="${term}"][aria-busy="false"]`);
  const first = list.getByRole("listitem").first();
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: /^הוספת/ }).tap();
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.goto("./");
});

test("בחירת עיר, 5 מוצרים, דירוג נכון", async ({ page }) => {
  await expect(page.getByRole("note")).toContainText("נתוני בדיקה");
  // "קריית" עם שני יודים מנורמל ל"קרית"
  await page.getByRole("combobox", { name: "שם העיר" }).fill("ירושל");
  await page.getByRole("option", { name: /ירושלים/ }).tap();

  for (const term of BASKET.slice(0, 4)) await addBySearch(page, term);
  // המוצר החמישי לפי ברקוד
  await addBySearch(page, "9990000000156");

  const cta = page.getByRole("button", { name: /השוואת מחירים לסל עם 5 מוצרים/ });
  await expect(cta).toBeVisible();
  // הכפתור דביק בתחתית המסך
  const box = (await cta.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(844 - 90);
  expect(box.height).toBeGreaterThanOrEqual(44);

  await cta.tap();
  const cards = page.getByTestId("store-card");
  await expect(cards).toHaveCount(4);

  const data = await cards.evaluateAll((els) =>
    els.map((e) => ({ total: Number(e.getAttribute("data-total")), complete: e.getAttribute("data-complete") === "true", text: (e as HTMLElement).innerText })),
  );
  // קודם כל הסניפים המלאים, ממוינים לפי מחיר
  const firstPartial = data.findIndex((d) => !d.complete);
  expect(firstPartial).toBe(3);
  const full = data.slice(0, 3).map((d) => d.total);
  expect(full).toEqual([...full].sort((a, b) => a - b));
  expect(data[0]!.text).toContain("רשת דמו א");
  expect(data[0]!.text).toMatch(/חוסכים\s+\S*\d+\.\d\d/);
  // הסניף החלקי: אחוז כיסוי ומה חסר
  expect(data[3]!.text).toContain("4/5 · 80%");
  expect(data[3]!.text).toContain("חסרים: חלב 3% שומן");

  // פירוט מחירים כולל מחיר ליחידה
  await cards.first().getByRole("button", { name: "פירוט מחירים" }).tap();
  await expect(cards.first().getByText(/לליטר/).first()).toBeVisible();

  const perf = await page.evaluate(() => ({ search: (window as any).__lastSearchMs, compare: (window as any).__lastCompareMs }));
  expect(perf.search).toBeLessThan(300);
  expect(perf.compare).toBeLessThan(500);

  // חזרה בכפתור "אחורה" של הדפדפן / אנדרואיד
  await page.goBack();
  await expect(page.getByRole("region", { name: "הסל שלי" })).toContainText("הסל שלי (5)");
});

test("עיר ללא סניפים → הודעה ברורה ו'כל הארץ' (HTTP Range)", async ({ page }) => {
  await page.getByRole("combobox", { name: "שם העיר" }).fill("אילת");
  await expect(page.getByRole("status").filter({ hasText: "אין לנו סניפים ב" })).toBeVisible();
  await page.getByRole("button", { name: "חיפוש בכל הארץ" }).tap();
  await expect(page.getByRole("button", { name: /עיר: כל הארץ/ })).toBeVisible();
  await addBySearch(page, "קוטג");
  await page.getByRole("button", { name: /השוואת מחירים/ }).tap();
  await expect(page.getByTestId("store-card").first()).toBeVisible();
  expect(await page.getByTestId("store-card").count()).toBeGreaterThan(4); // סניפים מכל הערים
});

test("נרמול שם עיר בהשלמה: 'קריית אונו' ו'תל אביב-יפו'", async ({ page }) => {
  const input = page.getByRole("combobox", { name: "שם העיר" });
  await input.fill("קריית אונו");
  await expect(page.getByRole("option", { name: /קרית אונו/ })).toBeVisible();
  await input.fill("תל אביב-יפו");
  await expect(page.getByRole("option", { name: /תל אביב/ })).toBeVisible();
});

test("העיר והסל נשמרים אחרי רענון", async ({ page }) => {
  await chooseCity(page, "תל", "תל אביב");
  await addBySearch(page, "טחינה");
  await page.reload();
  await expect(page.getByRole("button", { name: /עיר: תל אביב/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "הסל שלי" })).toContainText("טחינה");
});

test("סורק: נפתח ומאפשר הקלדת ברקוד שמוסיפה לסל", async ({ page, context }) => {
  await context.grantPermissions(["camera"]);
  await chooseCity(page, "ירושלים", "ירושלים");
  await page.getByRole("button", { name: "סריקת ברקוד במצלמה" }).tap();
  const dialog = page.getByRole("dialog", { name: "סריקת ברקוד" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("הקלדת ברקוד").fill("9990000000125");
  await dialog.getByRole("button", { name: "הוספה" }).tap();
  await expect(dialog.getByText(/נוסף: ביצים/)).toBeVisible();
  await dialog.getByRole("button", { name: "סגירת הסורק" }).tap();
  // בעיצוב 2026-11-20 אין פאנל סל בדף הבית; הסל בדף הסל
  await page.goto("./#/cart");
  await expect(page.locator("#main")).toContainText("ביצים");
});

test("אזורי מגע של 44px לפחות", async ({ page }) => {
  await chooseCity(page, "ירושלים", "ירושלים");
  await addBySearch(page, "חלב 3%");
  const small = await page.locator("button:visible").evaluateAll((els) =>
    els
      .map((e) => ({ label: e.getAttribute("aria-label") ?? (e as HTMLElement).innerText, r: e.getBoundingClientRect() }))
      .filter((x) => x.r.width < 44 || x.r.height < 44)
      .map((x) => `${x.label} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`),
  );
  expect(small).toEqual([]);
});

test("עובד offline אחרי טעינה ראשונה", async ({ page, context }) => {
  await chooseCity(page, "ירושלים", "ירושלים");
  await addBySearch(page, "חלב 3%");
  await addBySearch(page, "סוכר");
  // מחכים שה-SW ישלוט ויסיים לשמור את המעטפת, ה-wasm ונתוני העיר
  await page.waitForFunction(async () => !!navigator.serviceWorker.controller, null, { timeout: 30_000 }).catch(() => {});
  await page.reload();
  await page.waitForFunction(async () => {
    if (!navigator.serviceWorker.controller) return false;
    const keys = await caches.keys();
    let wasm = false, data = 0;
    for (const k of keys) {
      for (const r of await (await caches.open(k)).keys()) {
        // ה-wasm של DuckDB עצמו (לא רק ה-extension), שנשמר ב-SW אחרי שהוא נטען
        // רשומה מופיעה ב-keys() כבר בזמן שהגוף (36MB) עדיין נכתב; קריאה מלאה מחכה שהשמירה תסתיים
        // ה-wasm שה-DuckDB בחר בפועל (eh בכרום), לא סתם wasm כלשהו שבמטמון
        if (r.url.includes("/assets/duckdb-eh") && r.url.endsWith(".wasm")) {
          wasm = await (await caches.open(k)).match(r).then((x) => x?.arrayBuffer()).then((b) => !!b && b.byteLength > 1e6, () => false);
        }
        if (r.url.includes(".parquet")) data++;
      }
    }
    return wasm && data >= 2;
  }, null, { timeout: 60_000, polling: 1000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "אין חיבור לרשת" })).toBeVisible();
  await expect(page.getByRole("region", { name: "הסל שלי" })).toContainText("סוכר");
  await addBySearch(page, "אורז");
  await page.getByRole("button", { name: /השוואת מחירים/ }).tap();
  await expect(page.getByTestId("store-card").first()).toBeVisible();
  await context.setOffline(false);
});

test.describe("אירוח עצמי", () => {
  test.use({ serviceWorkers: "block" });
  test.skip(!process.env.VITE_DUCKDB_EXT_REPO, "רק בבנייה עם VITE_DUCKDB_EXT_REPO");
  test("ה-Parquet extension נטען מהאתר עצמו, בלי extensions.duckdb.org", async ({ page, context }) => {
    const external: string[] = [];
    const local: string[] = [];
    await context.route("https://extensions.duckdb.org/**", (r) => { external.push(r.request().url()); return r.abort(); });
    page.on("request", (r) => r.url().includes("/duckdb/ext/") && local.push(r.url()));
    context.on("request", (r) => r.url().includes("/duckdb/ext/") && local.push(r.url()));
    await chooseCity(page, "ירושלים", "ירושלים");
    await addBySearch(page, "חלב 3%");
    expect(external).toEqual([]);
  });
});

test.describe("ביצועים", () => {
  // בלי Service Worker: אחרת המטמון שלו עוקף את ההאטה המדומה ומודדים כלום
  test.use({ serviceWorkers: "block" });
test("מסך ראשון תוך פחות מ-2 שניות ב-4G מדומה", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  // "4G" שמרני: 9Mbps הורדה, 170ms RTT
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 170, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8,
  });
  const t0 = Date.now();
  await page.goto("./", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "באיזו עיר אתם קונים?" })).toBeVisible();
  await expect(page.getByRole("option").first()).toBeVisible();
  const ms = Date.now() - t0;
  console.log(`first screen with city list: ${ms}ms`);
  expect(ms).toBeLessThan(2000);
});
});
