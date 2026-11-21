import { describe, expect, test } from "bun:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { matchCities, normalizeCity } from "../src/shared/city.ts";
import { formatUnitPrice, packSize, parseUnit, unitPrice } from "../src/shared/units.ts";
import { normalizeSearch, parseQuery, SEARCH_KEY_SQL } from "../src/shared/search.ts";
import { normBarcode } from "../src/shared/barcode.ts";

describe("נרמול ערים", () => {
  test.each([
    ["קריית אונו", "קרית אונו"],
    ["קרית-אונו", "קרית אונו"],
    ["  קריית   ביאליק ", "קרית ביאליק"],
    ["תל אביב-יפו", "תל אביב"],
    ["תל אביב - יפו", "תל אביב"],
    ["תל-אביב", "תל אביב"],
    ["ת\"א", "תל אביב"],
    ["ראש העין", "ראש העין"],
    ["פתח תקוה", "פתח תקווה"],
    ["מודיעין-מכבים-רעות", "מודיעין"],
    ["באר־שבע", "באר שבע"],
    ["", ""],
  ])("%s → %s", (raw, key) => {
    expect(normalizeCity(raw)).toBe(key);
  });

  test("השלמה אוטומטית: תחילית קודמת", () => {
    const cities = ["קרית אונו", "קרית ביאליק", "אור עקיבא", "תל אביב"].map((k) => ({ key: k, name: k }));
    expect(matchCities(cities, "קריית").map((c) => c.key)).toEqual(["קרית אונו", "קרית ביאליק"]);
    expect(matchCities(cities, "אונו").map((c) => c.key)).toEqual(["קרית אונו"]);
    expect(matchCities(cities, "תל אביב-יפו").map((c) => c.key)).toEqual(["תל אביב"]);
  });
});

describe("מחיר ליחידה", () => {
  test("גרם → ל-100 גרם", () => {
    expect(unitPrice(590, { quantity: 500, unit_qty: "גרם", uom: "100 גרם" })).toEqual({ ag: 118, per: "100 גרם" });
  });
  test("ק\"ג", () => {
    expect(unitPrice(1290, { quantity: 1, unit_qty: "קילוגרם" })!.ag).toBeCloseTo(129);
    expect(parseUnit("ק\"ג")).toBe("kg");
  });
  test("UnitQty לא ידוע, היחידה ב-UnitOfMeasure (רמי לוי)", () => {
    expect(unitPrice(1250, { quantity: 1.32, unit_qty: "לא ידוע", uom: "ליטר" })).toEqual({ ag: 1250 / 1.32, per: "ליטר" });
  });
  test("מ\"ל → לליטר", () => {
    expect(unitPrice(990, { quantity: 750, unit_qty: "מיליליטר" })).toEqual({ ag: 1320, per: "ליטר" });
    expect(parseUnit("מ\"ל")).toBe("ml");
  });
  test("שקיל: מחיר לק\"ג → ל-100 גרם", () => {
    expect(unitPrice(1290, { is_weighted: true })).toEqual({ ag: 129, per: "100 גרם" });
  });
  test("יחידות / חסר מידע → null", () => {
    expect(unitPrice(1390, { quantity: 12, unit_qty: "יחידה" })).toBeNull();
    expect(unitPrice(1390, { quantity: 0, unit_qty: "גרם" })).toBeNull();
  });
  test("תצוגה", () => {
    expect(formatUnitPrice({ ag: 118, per: "100 גרם" })).toBe("₪1.18 ל-100 גרם");
    expect(formatUnitPrice({ ag: 1320, per: "ליטר" })).toBe("₪13.20 לליטר");
    expect(packSize({ quantity: 1.5, unit_qty: "ליטר" })).toBe("1.5 ליטר");
  });
});

describe("חיפוש", () => {
  test("ברקוד מזוהה ומנורמל", () => {
    expect(parseQuery(" 7290000000123 ")).toEqual({ barcode: "7290000000123", tokens: [] });
    expect(normBarcode("007290000000123")).toBe("7290000000123");
  });
  test("טוקנים מנורמלים", () => {
    expect(parseQuery("קוטג' 5%").tokens).toEqual(["קוטג", "5"]);
    expect(normalizeSearch("קוקה-קולה  זירו")).toBe("קוקה קולה זירו");
  });
  test("הנרמול ב-SQL זהה לנרמול ב-JS", async () => {
    const inst = await DuckDBInstance.create(":memory:");
    const con = await inst.connect();
    const samples = ["קוטג' 5% תנובה", "קוקה-קולה  זירו 1.5 ל", "חלב \"יטבתה\" (1 ליטר)", "שוקו/וניל", "Coca–Cola"];
    for (const s of samples) {
      const r = await con.runAndReadAll(`SELECT ${SEARCH_KEY_SQL("$s")} AS k`, { s });
      expect(r.getRowObjects()[0]!.k).toBe(normalizeSearch(s));
    }
    con.closeSync();
    inst.closeSync();
  });
});
