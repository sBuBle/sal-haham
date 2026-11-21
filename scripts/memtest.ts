/**
 * בדיקת זיכרון: יוצר קובץ PriceFull סינתטי של 300,000 מוצרים (gz, נכתב בהזרמה),
 * ומריץ את הפרסר (ואת ה-ingest המלא ל-DuckDB) בתהליך נפרד שמודד את שיא ה-RSS.
 *
 *   bun scripts/memtest.ts [--items 300000] [--limit-mb 100]
 *
 * יעד: פרסר < 100MB RSS בלי קשר לגודל הקובץ. מחזיר קוד יציאה 1 אם חרג.
 */
import { createWriteStream, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { once } from "node:events";

const CHAIN = "9990000000017";

export async function writeBigFile(path: string, items: number) {
  const gz = createGzip({ level: 1 });
  const out = createWriteStream(path);
  gz.pipe(out);
  const w = async (s: string) => {
    if (!gz.write(s)) await once(gz, "drain");
  };
  await w(`﻿<?xml version="1.0" encoding="utf-8"?>\n<Root><TestData>true</TestData><ChainId>${CHAIN}</ChainId><SubChainId>001</SubChainId><StoreId>001</StoreId>\n<Items Count="${items}">\n`);
  let buf = "";
  for (let i = 0; i < items; i++) {
    const code = String(990000000000 + i);
    buf += `<Item><PriceUpdateDate>2026-01-15 06:00:00</PriceUpdateDate><ItemCode>${code}</ItemCode><ItemType>1</ItemType>` +
      `<ItemName>מוצר בדיקה סינתטי מספר ${i} בטעם וניל</ItemName><ManufactureName>יצרן בדיקה ${i % 500}</ManufactureName>` +
      `<ManufactureCountry>ישראל</ManufactureCountry><UnitQty>גרם</UnitQty><Quantity>${100 + (i % 900)}.00</Quantity>` +
      `<UnitOfMeasure>100 גרם</UnitOfMeasure><bIsWeighted>0</bIsWeighted><ItemPrice>${(1 + (i % 9000) / 100).toFixed(2)}</ItemPrice>` +
      `<AllowDiscount>1</AllowDiscount><ItemStatus>1</ItemStatus></Item>\n`;
    if (buf.length > 1 << 16) {
      await w(buf);
      buf = "";
    }
  }
  await w(buf + `</Items></Root>\n`);
  gz.end();
  await once(out, "finish");
}

async function child(mode: string, file: string) {
  let peak = 0;
  const sample = () => (peak = Math.max(peak, process.memoryUsage().rss));
  const timer = setInterval(sample, 20);
  const base = process.memoryUsage().rss;
  const t0 = performance.now();
  let records = 0;
  if (mode === "parse") {
    const { openText } = await import("../src/ingest/decode.ts");
    const { parseRecords } = await import("../src/ingest/parser.ts");
    const { toItem } = await import("../src/ingest/records.ts");
    const o = await openText(file);
    await parseRecords(o.chunks, (k, r) => {
      if (k === "item" && toItem(r, CHAIN, "2026-01-15 06:00:00")) records++;
      if ((records & 4095) === 0) sample();
    }, undefined, ["item"]);
  } else {
    const { PriceDb } = await import("../src/ingest/db.ts");
    const db = await PriceDb.open(file + ".duckdb", { memoryLimit: process.env.MEM ?? "256MB", threads: 1 });
    const r = await db.ingestFile(file);
    records = r.rows ?? 0;
    await db.close();
  }
  sample();
  clearInterval(timer);
  console.log(JSON.stringify({ mode, records, baseMB: +(base / 2 ** 20).toFixed(1), peakMB: +(peak / 2 ** 20).toFixed(1), seconds: +((performance.now() - t0) / 1000).toFixed(1) }));
}

export async function runMemTest(items = 300_000, limitMb = 100) {
  const dir = mkdtempSync(join(tmpdir(), "salmem-"));
  const file = join(dir, `PriceFull${CHAIN}-001-001-20260115-060000.gz`);
  try {
    await writeBigFile(file, items);
    const size = statSync(file).size;
    const run = async (mode: string) => {
      const p = Bun.spawn([process.execPath, import.meta.path, "--child", mode, file], { stdout: "pipe", stderr: "inherit" });
      const out = await new Response(p.stdout).text();
      await p.exited;
      return JSON.parse(out.trim().split("\n").pop()!);
    };
    const parse = await run("parse");
    const ingest = await run("ingest");
    return { items, fileMB: +(size / 2 ** 20).toFixed(1), limitMb, parse, ingest, ok: parse.records === items && parse.peakMB < limitMb };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "--child") {
    await child(args[1]!, args[2]!);
  } else {
    const get = (k: string, d: number) => (args.includes(k) ? +args[args.indexOf(k) + 1]! : d);
    const r = await runMemTest(get("--items", 300_000), get("--limit-mb", 100));
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exit(1);
  }
}
