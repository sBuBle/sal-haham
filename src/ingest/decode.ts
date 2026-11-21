/**
 * פתיחת קובץ מחירים כזרם טקסט, בלי לטעון אותו לזיכרון:
 *  - מזהה דחיסה לפי magic bytes (gzip / ZIP / לא דחוס), כי יש קבצי .gz שהם בפועל ZIP
 *  - מזהה קידוד: UTF-8 (עם/בלי BOM), UTF-16 LE/BE (עם/בלי BOM), windows-1255 / ISO-8859-8 לפי הצהרת ה-XML
 *  - מפענח בהזרמה עם iconv-lite
 */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import iconv from "iconv-lite";
import { Unzip, UnzipInflate } from "fflate";

export type Compression = "gzip" | "zip" | "none";
export type Encoding = "utf8" | "utf16le" | "utf16be" | "windows-1255";

export function detectCompression(head: Uint8Array): Compression {
  if (head[0] === 0x1f && head[1] === 0x8b) return "gzip";
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return "zip";
  return "none";
}

export function detectEncoding(head: Uint8Array): Encoding {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return "utf8";
  if (head[0] === 0xff && head[1] === 0xfe) return "utf16le";
  if (head[0] === 0xfe && head[1] === 0xff) return "utf16be";
  // UTF-16 בלי BOM: "<\0" או "\0<"
  if (head[0] === 0x3c && head[1] === 0x00) return "utf16le";
  if (head[0] === 0x00 && head[1] === 0x3c) return "utf16be";
  // הצהרת XML (ASCII-תואם)
  const decl = Buffer.from(head.subarray(0, Math.min(head.length, 200))).toString("latin1");
  const m = decl.match(/encoding\s*=\s*["']([^"']+)["']/i);
  if (m) {
    const e = m[1]!.toLowerCase().replace(/[_\s]/g, "-");
    if (e === "windows-1255" || e === "cp1255" || e === "iso-8859-8" || e === "iso-8859-8-i" || e === "hebrew") return "windows-1255";
    if (e === "utf-16" || e === "utf-16le") return "utf16le";
  }
  // בלי הצהרה: אם זה לא UTF-8 תקין, כנראה windows-1255
  if (!isValidUtf8Prefix(head)) return "windows-1255";
  return "utf8";
}

function isValidUtf8Prefix(head: Uint8Array): boolean {
  // חותכים תו מרובה-בייטים שאולי נקטע בסוף החלון
  let end = head.length;
  for (let k = 1; k <= 3 && end - k >= 0; k++) {
    const b = head[end - k]!;
    if ((b & 0xc0) === 0xc0) { end -= k; break; }
    if ((b & 0x80) === 0) break;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/** קורא מהאיטרטור עד שיש לפחות n בייטים ומחזיר אותם יחד עם איטרטור שממשיך מאותה נקודה */
async function peek(src: AsyncIterable<Uint8Array>, n: number): Promise<{ head: Uint8Array; rest: AsyncIterable<Uint8Array> }> {
  const it = src[Symbol.asyncIterator]();
  const parts: Uint8Array[] = [];
  let len = 0;
  let done = false;
  while (len < n) {
    const r = await it.next();
    if (r.done) { done = true; break; }
    const c = r.value instanceof Uint8Array ? r.value : Buffer.from(r.value as any);
    parts.push(c);
    len += c.length;
  }
  const head = Buffer.concat(parts);
  const rest: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      if (head.length) yield head;
      if (done) return;
      while (true) {
        const r = await it.next();
        if (r.done) return;
        yield r.value;
      }
    },
  };
  return { head, rest };
}

async function* gunzipStream(src: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const gz = createGunzip();
  const input = Readable.from(src, { objectMode: false });
  input.on("error", (e) => gz.destroy(e));
  input.pipe(gz);
  for await (const chunk of gz) yield chunk as Uint8Array;
}

/** ZIP בהזרמה עם fflate: מחזיר את תוכן הקובץ הראשון בארכיון */
async function* unzipStream(src: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const out: Uint8Array[] = [];
  let taken = false;
  let error: unknown = null;
  const uz = new Unzip((file) => {
    if (taken || file.name.endsWith("/")) return;
    taken = true;
    file.ondata = (err, data) => {
      if (err) error = err;
      else if (data.length) out.push(data);
    };
    file.start();
  });
  uz.register(UnzipInflate);
  for await (const chunk of src) {
    uz.push(chunk);
    if (error) throw error;
    while (out.length) yield out.shift()!;
  }
  uz.push(new Uint8Array(0), true);
  if (error) throw error;
  while (out.length) yield out.shift()!;
  if (!taken) throw new Error("ZIP ריק");
}

export interface OpenedText {
  compression: Compression;
  encoding: Encoding;
  chunks: AsyncIterable<string>;
}

export async function openText(source: string | AsyncIterable<Uint8Array>): Promise<OpenedText> {
  const raw: AsyncIterable<Uint8Array> =
    typeof source === "string" ? (createReadStream(source, { highWaterMark: 64 * 1024 }) as any) : source;
  const p1 = await peek(raw, 4);
  const compression = detectCompression(p1.head);
  const bytes =
    compression === "gzip" ? gunzipStream(p1.rest) : compression === "zip" ? unzipStream(p1.rest) : p1.rest;
  const p2 = await peek(bytes, 200);
  const encoding = detectEncoding(p2.head);
  const decoder = iconv.getDecoder(encoding === "windows-1255" ? "windows1255" : encoding, { stripBOM: true });
  async function* text(): AsyncGenerator<string> {
    let first = true;
    for await (const c of p2.rest) {
      let s = decoder.write(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
      if (first && s) {
        s = s.replace(/^﻿/, "");
        first = false;
      }
      if (s) yield s;
    }
    const tail = decoder.end();
    if (tail) yield tail;
  }
  return { compression, encoding, chunks: text() };
}
