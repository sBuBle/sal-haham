import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import iconv from "iconv-lite";
import { zipSync } from "fflate";
import { openText } from "../src/ingest/decode.ts";
import { parseRecords } from "../src/ingest/parser.ts";
import { toItem, toStore } from "../src/ingest/records.ts";

const XML = (decl = "utf-8") =>
  `<?xml version="1.0" encoding="${decl}"?><Root><ChainId>7290000000001</ChainId><StoreId>007</StoreId><Items>` +
  `<Item><ItemCode>7290000000123</ItemCode><ItemName>  חלב   תנובה 3%  </ItemName><ItemPrice>6.90</ItemPrice></Item>` +
  `<Item><ItemCode>0005</ItemCode><ItemType>0</ItemType><ItemName>עגבניה</ItemName><ItemPrice>12.9</ItemPrice><bIsWeighted>1</bIsWeighted></Item>` +
  `</Items></Root>`;

/** מפצלים לחתיכות של 7 בייטים כדי לבדוק תווים מרובי-בייטים שנחתכים בין מקטעים */
async function* chunked(b: Uint8Array) {
  for (let i = 0; i < b.length; i += 7) yield b.subarray(i, i + 7);
}

async function parse(bytes: Uint8Array) {
  const o = await openText(chunked(bytes));
  const recs: Record<string, string>[] = [];
  const { ctx } = await parseRecords(o.chunks, (k, r) => {
    if (k === "item") recs.push(r);
  });
  return { o, recs, ctx };
}

const BOM8 = Buffer.from([0xef, 0xbb, 0xbf]);
const BOM16 = Buffer.from([0xff, 0xfe]);

describe("קידודים ודחיסה", () => {
  const cases: [string, () => Uint8Array, string, string][] = [
    ["UTF-8 בלי BOM", () => Buffer.from(XML()), "none", "utf8"],
    ["UTF-8 עם BOM", () => Buffer.concat([BOM8, Buffer.from(XML())]), "none", "utf8"],
    ["UTF-16LE עם BOM", () => Buffer.concat([BOM16, iconv.encode(XML("utf-16"), "utf16le")]), "none", "utf16le"],
    ["UTF-16LE בלי BOM", () => iconv.encode(XML("utf-16"), "utf16le"), "none", "utf16le"],
    ["UTF-16BE עם BOM", () => Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(XML("utf-16"), "utf16be")]), "none", "utf16be"],
    ["windows-1255 מוצהר", () => iconv.encode(XML("windows-1255"), "windows1255"), "none", "windows-1255"],
    ["ISO-8859-8 מוצהר", () => iconv.encode(XML("ISO-8859-8"), "windows1255"), "none", "windows-1255"],
    ["windows-1255 בלי הצהרה", () => iconv.encode(XML().replace(/<\?xml[^>]*>/, ""), "windows1255"), "none", "windows-1255"],
    ["gzip + UTF-8 BOM", () => gzipSync(Buffer.concat([BOM8, Buffer.from(XML())])), "gzip", "utf8"],
    ["gzip + UTF-16", () => gzipSync(Buffer.concat([BOM16, iconv.encode(XML("utf-16"), "utf16le")])), "gzip", "utf16le"],
    ["קובץ .gz שהוא בפועל ZIP", () => zipSync({ "a.xml": Buffer.from(XML()) }), "zip", "utf8"],
    ["ZIP + windows-1255", () => zipSync({ "a.xml": iconv.encode(XML("windows-1255"), "windows1255") }), "zip", "windows-1255"],
  ];
  for (const [name, make, comp, enc] of cases) {
    test(name, async () => {
      const { o, recs, ctx } = await parse(make());
      expect(o.compression).toBe(comp as any);
      expect(o.encoding).toBe(enc as any);
      expect(ctx.chainid).toBe("7290000000001");
      expect(recs.length).toBe(2);
      expect(recs[0]!.itemname).toBe("חלב תנובה 3%"); // רווחים מיותרים נוקו
    });
  }
});

describe("שמות תגים לא אחידים", () => {
  test("StoreId / StoreID / STOREID / asx:STOREID", async () => {
    for (const t of ["StoreId", "StoreID", "STOREID", "asx:STOREID"]) {
      const xml = `<?xml version="1.0"?><root xmlns:asx="x"><STORES><STORE><${t}>012</${t}><CITY>קריית  אונו</CITY><STORENAME> סניף </STORENAME></STORE></STORES></root>`;
      const o = await openText(chunked(Buffer.from(xml)));
      const stores: any[] = [];
      await parseRecords(o.chunks, (k, r, c) => {
        if (k === "store") stores.push(toStore(r, c, "7290000000001"));
      });
      expect(stores[0]).toMatchObject({ store_id: "12", city: "קריית אונו", city_key: "קרית אונו", store_name: "סניף" });
    }
  });
  test("קוד עיר מספרי מתורגם דרך רשימת הלמ\"ס; קוד לא מוכר לא מומצא", () => {
    const codes = new Map([["3000", "ירושלים"], ["5000", "תל אביב - יפו"]]);
    expect(toStore({ storeid: "1", city: "5000" }, {}, "c", codes)).toMatchObject({ city: "תל אביב - יפו", city_key: "תל אביב" });
    expect(toStore({ storeid: "1", city: "9999" }, {}, "c", codes)!.city).toBe("קוד יישוב 9999");
  });
  test("City=0: העיר מוסקת משם הסניף (מילה שלמה, ההתאמה הארוכה)", () => {
    const codes = new Map([["1", "יבנה"], ["2", "גן יבנה"], ["3", "אלון"], ["8300", "ראשון לציון"]]);
    expect(toStore({ storeid: "1", city: "0", storename: "גן יבנה" }, {}, "c", codes)!.city).toBe("גן יבנה");
    expect(toStore({ storeid: "1", city: "0", storename: "ראשלצ רמת אליהו" }, {}, "c", codes)!.city_key).toBe("ראשון לציון");
    expect(toStore({ storeid: "1", city: "0", storename: "יד אליהו", address: "אלון 5" }, {}, "c", codes)!.city).toBe("");
  });
  test("& לא מקודד לא שובר את הקובץ", async () => {
    const xml = `<Root><Items><Item><ItemCode>1</ItemCode><ItemName>A & B</ItemName><ItemPrice>1</ItemPrice></Item><Item><ItemCode>2</ItemCode><ItemPrice>2</ItemPrice></Item></Items></Root>`;
    const o = await openText(chunked(Buffer.from(xml)));
    const recs: any[] = [];
    await parseRecords(o.chunks, (_k, r) => {
      recs.push(r);
    });
    expect(recs.length).toBe(2);
    expect(recs[0].itemname).toBe("A & B");
  });
  test("ישויות HTML (&nbsp;) ו-& שנחתך בין מקטעים", async () => {
    const xml = `<Root><Items><Item><ItemCode>1</ItemCode><ItemName>ש&nbsp;ב &amp; ג&#1488; ד&</ItemName><ItemPrice>1</ItemPrice></Item></Items></Root>`;
    const o = await openText(chunked(Buffer.from(xml)));
    const recs: any[] = [];
    const { stats } = await parseRecords(o.chunks, (_k, r) => {
      recs.push(r);
    });
    expect(stats.errors).toBe(0);
    expect(recs[0].itemname).toBe("ש ב & גא ד&");
  });
});

describe("מיפוי מוצר", () => {
  test("ItemType=0 → מפתח chain:code, מחיר באגורות, שקיל", () => {
    const it = toItem({ itemcode: "0005", itemtype: "0", itemname: "עגבניה", itemprice: "12.9", bisweighted: "1" }, "7290000000001", "2026-01-01 00:00:00")!;
    expect(it).toMatchObject({ barcode: "7290000000001:5", price_ag: 1290, is_weighted: true });
  });
  test("ברקוד עם אפסים מובילים מנורמל; ManufactureName ו-ManufacturerName", () => {
    expect(toItem({ itemcode: "007290000000123", itemprice: "1", manufacturename: "תנובה" }, "c", "t")).toMatchObject({ barcode: "7290000000123", manufacturer: "תנובה" });
    expect(toItem({ itemcode: "1", itemprice: "1", manufacturername: "שטראוס" }, "c", "t")!.manufacturer).toBe("שטראוס");
  });
  test("ערכי מילוי כמו 'לא ידוע' נחשבים ריקים", () => {
    expect(toItem({ itemcode: "1", itemprice: "1", manufacturename: "לא ידוע" }, "c", "t")!.manufacturer).toBe("");
  });
  test("מחיר לא חוקי → נפסל", () => {
    expect(toItem({ itemcode: "1", itemprice: "0" }, "c", "t")).toBeNull();
    expect(toItem({ itemcode: "1", itemprice: "abc" }, "c", "t")).toBeNull();
    expect(toItem({ itemprice: "5" }, "c", "t")).toBeNull();
  });
  test("PriceUpdateDate בפורמטים שונים", () => {
    const f = (s: string) => toItem({ itemcode: "1", itemprice: "1", priceupdatedate: s }, "c", "FILE")!.valid_from;
    expect(f("2025-02-18T15:52:25.000")).toBe("2025-02-18 15:52:25");
    expect(f("2025/02/18 15:52")).toBe("2025-02-18 15:52:00");
    expect(f("18/02/2025 15:52:25")).toBe("2025-02-18 15:52:25");
    expect(f("garbage")).toBe("FILE");
  });
});
