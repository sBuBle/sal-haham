import { describe, expect, test } from "bun:test";
import { parseFileName, ingestOrder } from "../src/ingest/filename.ts";

describe("parseFileName", () => {
  test("Cerberus: Kind+chain-sub-store-date-time", () => {
    expect(parseFileName("PriceFull7290058140886-001-002-20261119-121500.gz")).toEqual({
      kind: "PriceFull", chainId: "7290058140886", subChainId: "001", storeId: "2", timestamp: "2026-11-19 12:15:00", ext: "gz",
    });
  });
  test("Price (לא Full) לא מתבלבל עם PriceFull", () => {
    expect(parseFileName("Price7290058140886-001-001-20261119-070010.gz")!.kind).toBe("Price");
  });
  test("שופרסל: Kind+chain-store-yyyymmddhhmm", () => {
    const p = parseFileName("PriceFull7290027600007-413-202611190300.gz")!;
    expect(p).toMatchObject({ kind: "PriceFull", chainId: "7290027600007", subChainId: null, storeId: "413", timestamp: "2026-11-19 03:00:00" });
  });
  test("Stores עם תת-רשת וזמן מקוצר", () => {
    const p = parseFileName("Stores7290027600007-000-20261119-020.gz")!;
    expect(p).toMatchObject({ kind: "Stores", subChainId: "000", storeId: null, timestamp: "2026-11-19 00:00:00" });
  });
  test("Stores עם hhmmss", () => {
    expect(parseFileName("Stores7290058140886-000-20261119-050500.xml")!.timestamp).toBe("2026-11-19 05:05:00");
  });
  test("Bina: סיומת באותיות גדולות, PromoFull", () => {
    const p = parseFileName("PromoFull7290058108879-000-340-20261119-140846.GZ")!;
    expect(p).toMatchObject({ kind: "PromoFull", storeId: "340", ext: "gz" });
  });
  test("StoresFull מנורמל ל-Stores; נתיב מלא מותר", () => {
    expect(parseFileName("C:\\raw\\x/StoresFull7290103152017-000-20261119-080501.xml")!.kind).toBe("Stores");
  });
  test("מזהה סניף בלי אפסים מובילים", () => {
    expect(parseFileName("PriceFull7290103152017-001-003-20261119-140501.gz")!.storeId).toBe("3");
  });
  test("שם לא מזוהה → null", () => {
    expect(parseFileName("readme.txt")).toBeNull();
    expect(parseFileName("PriceFull123-001-20261119.gz")).toBeNull(); // chain לא 13 ספרות
    expect(parseFileName("PriceFull7290058140886-001-001-nodate.gz")).toBeNull();
  });
  test("סדר טעינה: Stores, אחר כך לפי זמן, Full לפני עדכון", () => {
    const names = [
      "Price7290058140886-001-001-20261119-120000.gz",
      "PriceFull7290058140886-001-001-20261119-120000.gz",
      "PriceFull7290058140886-001-001-20261118-120000.gz",
      "Stores7290058140886-000-20261119-235900.xml",
    ];
    const sorted = names.map((n) => ({ n, m: parseFileName(n)! })).sort((a, b) => ingestOrder(a.m, b.m)).map((x) => x.n);
    expect(sorted).toEqual([names[3], names[2], names[1], names[0]]);
  });
});
