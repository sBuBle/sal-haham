/** בדיקת זיכרון: 300 אלף מוצרים, הפרסר חייב להישאר מתחת ל-100MB RSS (נמדד בתהליך נפרד). */
import { expect, test } from "bun:test";
import { runMemTest } from "../scripts/memtest.ts";

test("פרסר על 300,000 מוצרים < 100MB RSS", async () => {
  const r = await runMemTest(300_000, 100);
  console.log(`parse peak ${r.parse.peakMB}MB, full ingest peak ${r.ingest.peakMB}MB (file ${r.fileMB}MB gz)`);
  expect(r.parse.records).toBe(300_000);
  expect(r.ingest.records).toBe(300_000);
  expect(r.parse.peakMB).toBeLessThan(100);
}, 600_000);
