/** שמות הקבצים שכבר נטענו למסד (loaded_files), כדי לא להוריד אותם שוב. */
import { existsSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";

/**
 * קורא את המסד לקריאה בלבד. אם המסד נעול (תהליך אחר כותב) מנסים כמה פעמים; אם עדיין נעול, או שאין מסד —
 * מחזירים קבוצה ריקה: הכול יורד, וה-ingest מדלג על מה שכבר נטען (לפי sha256). איטי יותר, אבל נכון.
 */
export async function loadedFileNames(dbPath: string, log: (s: string) => void = () => {}, retries = 3): Promise<Set<string>> {
  if (dbPath === ":memory:" || !existsSync(dbPath)) return new Set();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const inst = await DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" });
      const con = await inst.connect();
      try {
        const has = (await con.runAndReadAll(`SELECT 1 FROM information_schema.tables WHERE table_name = 'loaded_files'`)).getRows().length > 0;
        if (!has) return new Set();
        const rows = (await con.runAndReadAll(`SELECT file_name FROM loaded_files`)).getRows();
        return new Set(rows.map((r) => String(r[0])));
      } finally {
        try { con.closeSync(); } catch {}
        try { inst.closeSync(); } catch {}
      }
    } catch (e) {
      if (attempt === retries) {
        log(`  המסד ${dbPath} לא נקרא (${String((e as Error).message).slice(0, 80)}) — מורידים הכול, קבצים שכבר נטענו ידולגו בטעינה`);
        return new Set();
      }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return new Set();
}
