import { expect, test } from "bun:test";
import { CATEGORIES, artFor, categoryOf, categoryWhere } from "../src/shared/categories.ts";
import { sqlString } from "../src/shared/search.ts";

test("קטגוריה לפי מילה בשם המוצר", () => {
  expect(categoryOf("חלב 3% תנובה 1 ליטר")?.id).toBe("dairy");
  expect(categoryOf("לחם אחיד פרוס אנג'ל")?.id).toBe("bakery");
  expect(categoryOf("עגבניות שרי 500 ג")?.id).toBe("produce");
  expect(categoryOf("נוזל כלים פיירי לימון")?.id).toBe("cleaning");
  expect(categoryOf("מברג פיליפס")).toBeNull();
  expect(categoryOf("קמח לבן")?.id).toBe("pantry");
  expect(categoryOf("שוקולד חלב")?.id).toBe("snacks");
});

test("מילה רק בתחילת מילה: 'מים' לא תופס 'חימום'", () => {
  expect(categoryOf("פלטת חימום")).toBeNull();
  expect(categoryOf("מים מינרליים נביעות")?.id).toBe("drinks");
});

test("איור ספציפי לפני איור הקטגוריה", () => {
  expect(artFor("ביצים L 12 יח'")).toBe("eggs");
  expect(artFor("יוגורט דנונה 3%")).toBe("yogurt");
  expect(artFor("חלב 1% תנובה")).toBe("milk");
  expect(artFor("אורז פרסי סוגת")).toBe("rice");
  expect(artFor("שוקולד חלב עלית")).toBe("choc");
  expect(artFor("קמח לבן")).toBe("flour");
  expect(artFor("מיץ תפוזים טבעי")).toBe("juice");
  expect(artFor("רסק עגבניות")).toBe("can");
  expect(artFor("מברג")).toBe("grocery");
  expect(artFor("סוכריות מנטוס")).toBe("grocery");
  expect(artFor("שמנת מתוקה 38%")).toBe("grocery");
  expect(artFor("סוכר לבן 1 ק\"ג")).toBe("sugar");
});

test("תנאי SQL לקטגוריה", () => {
  const w = categoryWhere(CATEGORIES.find((c) => c.id === "cleaning")!, sqlString);
  expect(w).toContain("LIKE '% נוזל כלים%'");
  expect(w.split(" OR ").length).toBe(CATEGORIES.find((c) => c.id === "cleaning")!.keywords.length);
});
