/** fetch עם ניסיונות חוזרים, cookie jar פשוט, והורדה בהזרמה לקובץ */
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const UA = "Mozilla/5.0 (compatible; sal-haham/0.1; +price-transparency-law)";

export class CookieJar {
  private jar = new Map<string, string>();
  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  store(res: Response) {
    const list = (res.headers as any).getSetCookie?.() ?? [];
    for (const c of list as string[]) {
      const [kv] = c.split(";");
      const i = kv!.indexOf("=");
      if (i > 0) this.jar.set(kv!.slice(0, i).trim(), kv!.slice(i + 1).trim());
    }
  }
}

export interface FetchOpts extends RequestInit {
  jar?: CookieJar;
  retries?: number;
  timeoutMs?: number;
}

export async function http(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { jar, retries = 2, timeoutMs = 60000, ...init } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = new Headers(init.headers);
      if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
      if (jar) {
        const c = jar.header();
        if (c) headers.set("Cookie", c);
      }
      const res = await fetch(url, { ...init, headers, redirect: init.redirect ?? "follow", signal: AbortSignal.timeout(timeoutMs) });
      jar?.store(res);
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        await Bun.sleep(1000 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await Bun.sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** כמה הורדות במקביל מאותו אתר. כמה רשתות יושבות על אותו פורטל (Cerberus), ואוספים כמה רשתות במקביל — המגבלה היא לאתר, לא לרשת. */
export const MAX_PER_HOST = Math.max(1, Number(process.env.COLLECT_PER_HOST ?? 6));
const hostSlots = new Map<string, { active: number; queue: (() => void)[] }>();
async function withHostSlot<T>(url: string, fn: () => Promise<T>): Promise<T> {
  let host = "";
  try { host = new URL(url).host; } catch {}
  let s = hostSlots.get(host);
  if (!s) hostSlots.set(host, (s = { active: 0, queue: [] }));
  if (s.active >= MAX_PER_HOST) await new Promise<void>((r) => s!.queue.push(r));
  else s.active++;
  try {
    return await fn();
  } finally {
    const next = s.queue.shift();
    if (next) next(); // המקום עובר ישר לממתין הבא
    else s.active--;
  }
}

export async function downloadTo(url: string, path: string, opts: FetchOpts = {}): Promise<number> {
  return withHostSlot(url, async () => {
    const res = await http(url, { ...opts, timeoutMs: opts.timeoutMs ?? 300000 });
    if (!res.ok || !res.body) throw new Error(`download ${res.status} ${url}`);
    let bytes = 0;
    const body = Readable.fromWeb(res.body as any);
    body.on("data", (c: Buffer) => (bytes += c.length));
    await pipeline(body, createWriteStream(path));
    return bytes;
  });
}

/** מריץ משימות במקביל מוגבל */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}
