/* סל חכם: Service Worker
 * - מעטפת האפליקציה: network-first לניווט (עם fallback ל-index.html השמור)
 * - assets/ (קבצים עם hash, כולל DuckDB-WASM): cache-first
 * - data/index.json: network-first עם fallback
 * - data/... עם ?v=: cache-first (הגרסה בשם ה-URL); גרסאות ישנות של אותו קובץ נמחקות
 * - בקשות Range (מצב "כל הארץ") עוברות לרשת בלי לגעת
 * - extensions.duckdb.org: cache-first, כדי שה-Parquet extension יעבוד גם offline
 */
const VERSION = "v23";
// הקבצים סטטיים: Vary (Origin / Accept-Encoding) של שרת סטטי לא אמור למנוע התאמה
const MATCH = { ignoreVary: true };
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const DATA = `data-${VERSION}`;
const EXT = `ext-${VERSION}`;
const SHELL_URLS = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png"];
// איורי המוצרים והקטגוריות (קטנים) נשמרים מראש כדי שהחנות תיראה שלמה גם offline
// redesign 2026-11-20: no illustrations or photos; icons are inline SVG
const ART_URLS = [];

self.addEventListener("install", (e) => {
  e.waitUntil(
    // כל קובץ בנפרד: addAll נכשל כולו אם קובץ אחד חסר, ואז שום אייקון לא נשמר ל-offline
    caches.open(SHELL).then(async (c) => {
      await Promise.all([...SHELL_URLS, ...ART_URLS].map((u) => c.add(u).catch(() => {})));
    }).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS, DATA, EXT]);
      for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "cache-urls" && Array.isArray(e.data.urls)) {
    e.waitUntil(
      (async () => {
        for (const u of e.data.urls) {
          try {
            const url = new URL(u);
            if (url.origin !== location.origin && url.hostname !== "extensions.duckdb.org") continue;
            const cacheName = pickCache(url);
            if (!cacheName) continue;
            const cache = await caches.open(cacheName);
            if (await cache.match(u, MATCH)) continue;
            if (inflight.has(u)) { await inflight.get(u).catch(() => {}); continue; }
            const job = (async () => {
              const res = await fetch(u);
              if (res.ok && res.status === 200) await put(cache, new Request(u), res);
            })().finally(() => inflight.delete(u));
            inflight.set(u, job);
            await job;
          } catch {}
        }
      })(),
    );
  }
});

function pickCache(url) {
  if (url.hostname === "extensions.duckdb.org") return EXT;
  const p = url.pathname;
  if (p.includes("/assets/")) return ASSETS;
  if (p.includes("/data/") && url.searchParams.has("v")) return DATA;
  return null;
}

async function put(cache, req, res) {
  const url = new URL(req.url);
  if (cache === undefined) return;
  // גרסה חדשה של קובץ נתונים: מוחקים גרסאות קודמות של אותו נתיב
  if (url.searchParams.has("v")) {
    for (const k of await cache.keys()) {
      const ku = new URL(k.url);
      if (ku.pathname === url.pathname && ku.search !== url.search) await cache.delete(k);
    }
  }
  await cache.put(req, res);
}

/* הורדות שנשמרות כרגע, כדי לא להוריד פעמיים קובץ ענק (ה-wasm) שכבר בדרך */
const inflight = new Map();

/* השמירה רצה ב-waitUntil ובבקשה בלי ה-signal של הדף: אם הדף נטען מחדש באמצע הורדה
   (למשל ה-wasm של 36MB), השמירה לא מתבטלת יחד איתו */
async function cacheFirst(req, cacheName, event) {
  const cache = await caches.open(cacheName);
  let hit = await cache.match(req, MATCH);
  if (hit) return hit;
  if (inflight.has(req.url)) {
    await inflight.get(req.url).catch(() => {});
    hit = await cache.match(req, MATCH);
    if (hit) return hit;
  }
  const detached = new Request(req.url, { mode: req.mode === "navigate" ? "same-origin" : req.mode, credentials: req.credentials });
  let res;
  try {
    res = await fetch(detached);
  } catch (err) {
    // offline: לפעמים הרשומה נמצאת במטמון אחר (שמירה דרך cache-urls) או נשמרה ממש עכשיו — בודקים שוב בכל המטמונים
    const any = (await caches.match(req.url, MATCH)) ?? (await caches.match(req.url, { ...MATCH, ignoreSearch: true }));
    if (any) return any;
    throw err;
  }
  if (res.ok && res.status === 200) {
    const saving = put(cache, new Request(req.url), res.clone()).catch(() => {}).finally(() => inflight.delete(req.url));
    inflight.set(req.url, saving);
    if (event) event.waitUntil(saving);
  }
  return res;
}

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    // דף האפליקציה תמיד מהרשת (לא ממטמון ה-HTTP של הדפדפן), כדי שגרסה חדשה תופיע ברענון הראשון
    const res = await fetch(req.mode === "navigate" ? new Request(req.url, { cache: "no-store", credentials: req.credentials }) : req);
    if (res.ok) await cache.put(fallbackUrl ?? req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(fallbackUrl ?? req, MATCH)) ?? (await cache.match(req, { ...MATCH, ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.headers.has("range")) return; // HTTP Range (כל הארץ) — ישירות לרשת
  const url = new URL(req.url);

  if (url.hostname === "extensions.duckdb.org") {
    e.respondWith(cacheFirst(req, EXT, e));
    return;
  }
  if (url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req, SHELL, new URL("./index.html", self.registration.scope).href));
    return;
  }
  const p = url.pathname;
  if (p.includes("/assets/")) {
    e.respondWith(cacheFirst(req, ASSETS, e));
    return;
  }
  if (p.endsWith("/data/index.json")) {
    e.respondWith(networkFirst(req, DATA));
    return;
  }
  if (p.includes("/data/")) {
    e.respondWith(url.searchParams.has("v") ? cacheFirst(req, DATA, e) : networkFirst(req, DATA));
    return;
  }
  if (p.endsWith("/sw.js")) return;
  e.respondWith(networkFirst(req, SHELL));
});
