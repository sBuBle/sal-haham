/** רכיבים ועזרים משותפים לכל הדפים: אייקונים, מחיר, איור מוצר, לוגו רשת, כמות, ניתוב, הקשר האפליקציה. */
import { createContext } from "preact";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { formatMoney, formatDate, type Market } from "../../src/shared/market.ts";
import { parseUnit, unitPrice, type UnitInfo } from "../../src/shared/units.ts";
import { categoryOf, CATEGORIES, CATEGORY_EN, SUBCATEGORIES } from "../../src/shared/categories.ts";
import { getLang, t } from "./i18n.ts";
import { Illus } from "./illus.tsx";
import type { Product, Scope } from "./engine.ts";
import type { SiteIndex, StoreRow } from "./data.ts";

// ---------------------------------------------------------------- app context
export type CityChoice = { kind: "city"; key: string; name: string; slug: string } | { kind: "all" };
export interface BasketItem extends Omit<Product, "n_stores" | "max_ag"> { qty: number }
export interface Ctx {
  market: Market;
  index: SiteIndex | null;
  city: CityChoice;
  scope: Scope;
  ready: boolean;
  failed: boolean;
  /** סניפי העיר (אם נבחרה רשת — רק שלה) */
  stores: StoreRow[] | null;
  /** הרשת שנבחרה בסינון (null = כל הרשתות) */
  chain: string | null;
  setChain: (chain: string | null) => void;
  basket: BasketItem[];
  inBasket: Map<string, number>;
  add: (p: Product | BasketItem, qty?: number) => void;
  setQty: (barcode: string, qty: number) => void;
  replace: (oldBarcode: string, p: Product) => void;
  clear: () => void;
  setBasket: (b: BasketItem[]) => void;
  say: (msg: string) => void;
  pickCity: () => void;
}
export const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export const cityLabel = (c: CityChoice | null) => (!c ? t("chooseCity") : c.kind === "all" ? t("allCountry") : c.name);
export const cityIn = (c: CityChoice | null) => (c?.kind === "all" ? t("inAll") : t("inCity", { city: cityLabel(c) }));

// ---------------------------------------------------------------- routing (clean addresses: /search?q=…, /category/dairy/cheese, /product/123, /basket …)
export type Route =
  | { name: "home" }
  | { name: "search"; q: string; cat: string | null; sub?: string | null }
  | { name: "product"; barcode: string }
  | { name: "cart" }
  | { name: "compare" }
  | { name: "plan" }
  | { name: "account" }
  | { name: "help" }
  | { name: "notfound" };

/** תיקיית האתר (/ או /שם-תיקייה/ באירוח בתת-תיקייה) */
export const BASE: string = (import.meta.env.BASE_URL as string) || "/";
/** כתובת פנימית עם תיקיית האתר: u("/basket") */
export const u = (path: string) => BASE + path.replace(/^\//, "");
/** הכתובת הציבורית של האתר (הגדרה אחת: VITE_PUBLIC_URL בבנייה). בלי הגדרה: הכתובת הנוכחית, אלא אם זה מחשב מקומי —
 *  אז "" ושיתוף נשלח כטקסט בלבד (קישור ל-localhost לא עוזר למי שמקבל אותו) */
const isLocalHost = (h: string) => /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(h);
export const PUBLIC_URL: string = ((import.meta.env.VITE_PUBLIC_URL as string | undefined) || (typeof location !== "undefined" && !isLocalHost(location.hostname) ? location.origin + BASE : "")).replace(/\/?$/, "/").replace(/^\/$/, "");
/** קישור לשיתוף (או "" כשאין כתובת ציבורית) */
export function shareUrl(path: string, params: Record<string, string | null | undefined> = {}): string {
  if (!PUBLIC_URL) return "";
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return PUBLIC_URL + path.replace(/^\//, "") + (q ? (path.includes("?") ? "&" : "?") + q : "");
}

/** הנתיב היחסי לתיקיית האתר, כולל ?query */
export function currentPath(): string {
  const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname.replace(/^\//, "");
  return "/" + p.replace(/^index\.html$/, "") + location.search;
}

const LEGACY_SUBS: Record<string, string> = {
  "cleaning/care": "care/", "cleaning/paper": "paper/", "cleaning/baby": "baby/", "pantry/baking": "pantry/flour", "pantry/sauces": "cooking/sauces",
  "drinks/hot": "coffee/", "drinks/alcohol": "alcohol/", "snacks/icecream": "frozen/icecream", "meat/sausage": "deli/cuts", "dairy/butter": "dairy/butter",
};
/** פענוח כתובת. מקבל גם כתובות ישנות ("#/p/123", "#/search?cat=dairy", "#/cart") */
export function parseRoute(path: string): Route {
  const [pathname, qs] = path.replace(/^#/, "").split("?");
  const p = new URLSearchParams(qs ?? "");
  const seg = (pathname ?? "").split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  switch (seg[0]?.toLowerCase()) {
    case undefined: return { name: "home" };
    case "search": return { name: "search", q: p.get("q") ?? "", cat: p.get("cat"), sub: p.get("sub") };
    case "category": {
      if (!seg[1]) return { name: "search", q: "", cat: null };
      let cat: string = seg[1].toLowerCase(), sub: string | null = seg[2]?.toLowerCase() ?? null;
      // כתובות מהעץ הישן (8 מחלקות) עוברות למקום החדש
      const moved = LEGACY_SUBS[`${cat}/${sub ?? ""}`];
      if (moved) { const [c2, s2] = moved.split("/"); cat = c2!; sub = s2 || null; }
      if (cat === "other" && !sub && seg.length === 2) return { name: "search", q: "", cat: "other", sub: null };
      // קטגוריה או תת-קטגוריה שלא קיימות — דף "לא נמצא", לא רשימה ריקה
      if (!CATEGORIES.some((c) => c.id === cat) || (sub && !SUBCATEGORIES[cat]?.some((s) => s.id === sub)) || seg.length > 3) return { name: "notfound" };
      return { name: "search", q: "", cat, sub };
    }
    case "product": case "p": return seg[1] && /^[\w:.-]+$/.test(seg[1]) ? { name: "product", barcode: seg[1] } : { name: "notfound" };
    case "basket": case "cart": return { name: "cart" };
    case "compare": return { name: "compare" };
    case "plan": return { name: "plan" };
    case "account": return { name: "account" };
    case "help": return { name: "help" };
    default: return { name: "notfound" };
  }
}
/** כתובת קנונית (בלי תיקיית האתר) */
export function pathOf(r: Route): string {
  switch (r.name) {
    case "home": return "/";
    case "search": {
      if (r.cat && !r.q) return `/category/${encodeURIComponent(r.cat)}${r.sub ? "/" + encodeURIComponent(r.sub) : ""}`;
      return r.q ? `/search?q=${encodeURIComponent(r.q)}` : "/search";
    }
    case "product": return `/product/${encodeURIComponent(r.barcode)}`;
    case "cart": return "/basket";
    case "notfound": return currentPath();
    default: return `/${r.name}`;
  }
}
export const href = (r: Route) => u(pathOf(r));

/** האם הניווט האחרון היה "אחורה/קדימה" (popstate) — כדי להחזיר את מיקום הגלילה */
export const nav = { pop: false, forward: false };
let fwdTimer = 0;
/** ניווט קדימה (קישור או go) — Chrome שולח popstate גם עליו, אז מסמנים אותו כדי לא לבלבל עם "אחורה" */
export const markForward = () => { nav.forward = true; clearTimeout(fwdTimer); fwdTimer = window.setTimeout(() => (nav.forward = false), 300); };
// לכל דף: מיקום הגלילה, וגם איזה מוצר היה בראש המסך (התוכן נטען מחדש ומשנה גובה, אז מוצר הוא עוגן מדויק יותר)
const scrollMemo = new Map<string, { y: number; key?: string; off?: number }>();
const anchorOf = () => {
  const top = (document.querySelector(".top") as HTMLElement | null)?.offsetHeight ?? 0;
  for (const el of document.querySelectorAll<HTMLElement>("[data-anchor]")) {
    const r = el.getBoundingClientRect();
    if (r.bottom > top + 8) return { key: el.dataset.anchor!, off: r.top };
  }
  return {};
};
if (typeof window !== "undefined") {
  // הדפדפן לא משחזר גלילה בעצמו (הוא עושה את זה לפני שהדף הישן הוחלף, ודורס את המיקום השמור)
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  addEventListener("popstate", () => { nav.pop = !nav.forward; if (nav.pop) restoring = true; });
  let raf = 0;
  addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!restoring) scrollMemo.set(location.pathname + location.search, { y: scrollY, ...anchorOf() }); }); }, { passive: true });
}
let restoring = false;
/** אחרי מעבר דף: חזרה (אחורה) — לאותו מקום (לפי המוצר שהיה בראש המסך); דף חדש — לראש הדף */
export function restoreScroll() {
  const m = nav.pop ? scrollMemo.get(location.pathname + location.search) : undefined;
  nav.pop = false; nav.forward = false;
  const t0 = performance.now();
  if (!m || !m.y) {
    restoring = false;
    scrollTo(0, 0);
    const top = () => { if (scrollY) scrollTo(0, 0); if (performance.now() - t0 < 400) requestAnimationFrame(top); };
    requestAnimationFrame(top);
    return;
  }
  restoring = true;
  let userMoved = false, okSince = 0;
  const stop = () => { userMoved = true; };
  addEventListener("touchstart", stop, { once: true, passive: true });
  addEventListener("wheel", stop, { once: true, passive: true });
  const target = () => {
    if (m.key) {
      const el = document.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(m.key)}"]`);
      if (el) return scrollY + el.getBoundingClientRect().top - (m.off ?? 0);
      return null;
    }
    return m.y;
  };
  const again = () => {
    const y = target();
    if (y !== null && Math.abs(scrollY - y) > 2) scrollTo(0, y);
    const now = performance.now();
    if (y !== null && Math.abs(scrollY - y) <= 2) { if (!okSince) okSince = now; } else okSince = 0;
    // ממשיכים עד שהמיקום יציב חצי שנייה (או 4 שניות בסך הכול), אלא אם המשתמש גלל
    if (!userMoved && now - t0 < 4000 && (!okSince || now - okSince < 500)) requestAnimationFrame(again);
    else restoring = false;
  };
  requestAnimationFrame(again);
}

const ROUTE_EVENT = "sal:route";
/** replace=true לא מוסיף רשומה להיסטוריה (הקלדה בחיפוש) */
export function go(r: Route, replace = false) {
  navigate(href(r), replace);
}
/** מעבר לכתובת פנימית (כולל ?query) בלי טעינה מחדש */
export function navigate(url: string, replace = false) {
  if (location.pathname + location.search === url) return;
  markForward();
  if (replace) history.replaceState(history.state, "", url);
  else history.pushState(null, "", url);
  dispatchEvent(new Event(ROUTE_EVENT));
}
if (typeof window !== "undefined") {
  // כתובות ישנות עם "#/…" (קישורים ששמרתם או שיתפתם) עוברות לכתובת הנקייה, בלי רשומה נוספת בהיסטוריה
  const fromHash = () => {
    if (!location.hash.startsWith("#/")) return false;
    history.replaceState(null, "", href(parseRoute(location.hash)) + (location.search && !location.hash.includes("?") ? location.search : ""));
    return true;
  };
  fromHash();
  // גם כשקישור ישן נפתח בתוך דף שכבר פתוח (רק ה-# משתנה)
  addEventListener("hashchange", () => { if (fromHash()) dispatchEvent(new Event(ROUTE_EVENT)); });
  // קישורים פנימיים (<a href="/…">) נפתחים בתוך האפליקציה; לחיצה עם Ctrl/Cmd או "פתיחה בכרטיסייה חדשה" עובדות כרגיל
  addEventListener("click", (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin || !a.pathname.startsWith(BASE)) return;
    if (/\.(json|webp|png|jpg|svg|wav|parquet|pdf)$/i.test(a.pathname)) return;
    if (a.getAttribute("href")!.startsWith("#") && !a.getAttribute("href")!.startsWith("#/")) return;
    e.preventDefault();
    navigate(a.pathname + a.search);
  });
}
export function useRoute(): Route {
  const [r, setR] = useState(() => parseRoute(currentPath()));
  const cur = useRef(r);
  useEffect(() => {
    const on = () => {
      const next = parseRoute(currentPath());
      // מעבר רך בין דפים (View Transitions API); בלי תמיכה או עם "הפחתת תנועה" — מיידי
      const d = document as any;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (d.startViewTransition && !reduce && cur.current.name !== next.name) {
        cur.current = next;
        const vt = d.startViewTransition(() => { setR(next); return new Promise<void>((res) => setTimeout(res, 0)); });
        for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p?.catch?.(() => {});
      } else {
        cur.current = next;
        setR(next);
      }
    };
    addEventListener(ROUTE_EVENT, on);
    addEventListener("popstate", on);
    return () => { removeEventListener(ROUTE_EVENT, on); removeEventListener("popstate", on); };
  }, []);
  return r;
}

// ---------------------------------------------------------------- recent searches (this device only)
const K_RECENT = "sal.recentQ";
export function recentSearches(): string[] { try { return JSON.parse(localStorage.getItem(K_RECENT) ?? "[]"); } catch { return []; } }
export function addRecent(q: string) {
  const v = q.trim();
  if (v.length < 2) return;
  const list = [v, ...recentSearches().filter((x) => x !== v && !v.startsWith(x))].slice(0, 8);
  try { localStorage.setItem(K_RECENT, JSON.stringify(list)); } catch {}
}
export function clearRecent() { try { localStorage.removeItem(K_RECENT); } catch {} }

// ---------------------------------------------------------------- money & units
export const money = (minor: number, m: Market) => formatMoney(minor, m, getLang() === "he" ? m.locale : "en-US");
/** מחיר: ספרות טבלאיות וסימן מטבע קטן ובהיר יותר */
/** ערך שמתחלף בהדרגה (count-up) כשהוא משתנה; מיידי עם "הפחתת תנועה" */
export function useTween(target: number, ms = 450): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || matchMedia("(prefers-reduced-motion: reduce)").matches) { from.current = target; setV(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = Math.round(start + (target - start) * e);
      from.current = cur;
      setV(cur);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}
export function Price(props: { ag: number; class?: string; animate?: boolean }) {
  const app = useApp();
  const tw = useTween(props.ag);
  const s = money(props.animate ? tw : props.ag, app.market);
  const num = s.match(/-?[\d,]+(\.\d+)?/)?.[0] ?? s;
  const cur = s.replace(num, "").replace(/[‎‏\s]/g, "");
  const curFirst = !!cur && s.indexOf(cur) < s.indexOf(num);
  return (
    <span class={`price ${props.class ?? ""}`}>
      {curFirst && <span class="cur">{cur}</span>}<span class="num">{num}</span>{!curFirst && cur && <span class="cur">{cur}</span>}
    </span>
  );
}
export const date = (s: string | null | undefined, m: Market, time = false) => formatDate(s, getLang() === "he" ? m.locale : "en-GB", time);

export function packLabel(info: UnitInfo): string {
  const he = getLang() === "he";
  if (info.is_weighted) return he ? "שקיל, לק\"ג" : "Weighed, per kg";
  const q = Number(info.quantity);
  if (!(q > 0)) return "";
  const unit = parseUnit(info.unit_qty) ?? parseUnit(info.uom);
  const n = Number.isInteger(q) ? String(q) : String(+q.toFixed(3));
  const names = he ? { g: "גרם", kg: 'ק"ג', ml: 'מ"ל', l: "ליטר", unit: "יח'" } : { g: "g", kg: "kg", ml: "ml", l: "L", unit: "units" };
  if (!unit) return "";
  if (unit === "unit" && q === 1) return "";
  return `${n} ${names[unit]}`;
}
export function unitLabel(priceAg: number, info: UnitInfo, m: Market): string {
  const u = unitPrice(priceAg, info);
  if (!u) return "";
  const per = u.per === "ליטר" ? (getLang() === "he" ? "לליטר" : "/ L") : getLang() === "he" ? "ל-100 גרם" : "/ 100 g";
  return `${money(Math.round(u.ag), m)} ${per}`;
}

export const catName = (id: string) => id === "other" ? (getLang() === "he" ? "עוד מוצרים" : "More products") : getLang() === "he" ? CATEGORIES.find((c) => c.id === id)?.name ?? id : CATEGORY_EN[id] ?? id;
/** "עוד מוצרים": מה שלא שויך לאף מחלקה */
export const OTHER_CAT = { id: "other", name: "עוד מוצרים", art: "grocery", keywords: [] as string[] };

// ---------------------------------------------------------------- icons (1.5px line, 24 grid; design/redesign-2026-11-20/lib.ts)
export const P = {
  search: "M11 3.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM20.5 20.5l-4.2-4.2",
  pin: "M19 10c0 5.5-7 11-7 11s-7-5.5-7-11a7 7 0 0 1 14 0zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  cart: "M5.5 10 9 4M18.5 10 15 4M2.5 10h19M4 10l1.6 8.4A2 2 0 0 0 7.6 20h8.8a2 2 0 0 0 2-1.6L20 10M9.5 13.5v3M14.5 13.5v3",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash: "M3.5 6.5h17M9 6.5V4h6v2.5M18.5 6.5l-1 14h-11l-1-14M10 10.5v6M14 10.5v6",
  down: "m6 9 6 6 6-6",
  up: "m18 15-6-6-6 6",
  /** קדימה בכיוון הקריאה (ב-RTL: שמאלה) */
  fwd: "m15 18-6-6 6-6",
  back: "M5 12h14M13 6l6 6-6 6",
  arrow: "M19 12H5M11 18l-6-6 6-6",
  barcode: "M3.5 7.5v-2a2 2 0 0 1 2-2h2M16.5 3.5h2a2 2 0 0 1 2 2v2M20.5 16.5v2a2 2 0 0 1-2 2h-2M7.5 20.5h-2a2 2 0 0 1-2-2v-2M7.5 8v8M10.5 8v8M13.5 8v8M16.5 8v8",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  check: "M20 6 9 17l-5-5",
  close: "M18 6 6 18M6 6l12 12",
  filter: "M20.5 6.5h-8M8.5 6.5h-5M20.5 17.5h-5M11.5 17.5h-8M8.5 4v5M15.5 15v5",
  heart: "M19 13.5c1.5-1.5 2.5-3 2.5-5A5 5 0 0 0 16.5 3.5c-1.8 0-3 .6-4.5 2-1.5-1.4-2.7-2-4.5-2A5 5 0 0 0 2.5 8.5c0 2 1 3.5 2.5 5l7 7z",
  heartO: "M19 13.5c1.5-1.5 2.5-3 2.5-5A5 5 0 0 0 16.5 3.5c-1.8 0-3 .6-4.5 2-1.5-1.4-2.7-2-4.5-2A5 5 0 0 0 2.5 8.5c0 2 1 3.5 2.5 5l7 7z ",
  user: "M19 20.5v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v1.5M12 3.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  home: "M3.5 10 12 3.5l8.5 6.5v10.5h-5.5v-6h-6v6H3.5z",
  sound: "M11 5 6 9H3v6h3l5 4zM15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12",
  mute: "M11 5 6 9H3v6h3l5 4zM16 9.5l5 5M21 9.5l-5 5",
  info: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 16v-4.5M12 8h.01",
  warn: "M10.3 4.2 2.6 17.6a2 2 0 0 0 1.7 2.9h15.4a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4M12 17h.01",
  store: "M3.5 9.5 5 4h14l1.5 5.5M4.5 9.5v10.5h15V9.5M3.5 9.5h17M9.5 20v-5.5h5V20",
  chart: "M3.5 3.5v17h17M8 16.5v-4M12.5 16.5V7.5M17 16.5v-7",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2",
  trendDown: "M21 17l-7.5-7.5-4.5 4.5L3 8M15 17h6v-6",
  trendUp: "M21 7l-7.5 7.5-4.5-4.5L3 16M15 7h6v6",
  globe: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5z",
  list: "M9 6.5h11.5M9 12h11.5M9 17.5h11.5M4 6.5h.01M4 12h.01M4 17.5h.01",
  grid: "M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM13.5 13.5h7v7h-7zM3.5 13.5h7v7h-7z",
  route: "M6 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 18.5h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16",
  nav: "M3.5 11 20.5 3.5 13 20.5l-2-7.5z",
  swap: "M16 3.5l4 4-4 4M20 7.5H4M8 20.5l-4-4 4-4M4 16.5h16",
  shield: "M12 21s7.5-3.5 7.5-9.5V5.5L12 3 4.5 5.5v6C4.5 17.5 12 21 12 21zM9 12l2 2 4-4",
  truck: "M2.5 6.5h11v10h-11zM13.5 10h4l3 3v3.5h-7M6.5 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  dots: "M12 6h.01M12 12h.01M12 18h.01",
  tag: "M3.5 12V3.5H12l8.5 8.5-8.5 8.5zM8 8h.01",
  wifiOff: "M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2-1.5M12 20h.01",
  lock: "M5.5 11h13v9.5h-13zM8 11V7.5a4 4 0 0 1 8 0V11",
  share: "M18 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1",
  download: "M12 3.5v12M7 10.5l5 5 5-5M4 20.5h16",
  help: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  bell: "M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5zM10.3 20.5a2 2 0 0 0 3.4 0",
};
/** אייקוני קטגוריה (אותה משפחת קו) */
export const CAT_ICON: Record<string, string> = {
  dairy: "M8.5 2.5h7v3l2.5 3.5v12.5h-12V9l2.5-3.5zM6 9h12M10 14h4",
  bakery: "M6 11a3.5 3.5 0 0 1 0-7h12a3.5 3.5 0 0 1 0 7v9.5H6zM9.5 14.5h5",
  produce: "M12 7.5c-2-1.8-7-1.3-7 4 0 5 3.5 9.5 7 8.8 3.5.7 7-3.8 7-8.8 0-5.3-5-5.8-7-4zM12 7.5c0-2 1-3.8 3-5",
  meat: "M14.5 3.5 C16.9 3.53 19.05 5 19.96 7.21 C20.88 9.43 20.38 11.99 18.7 13.7 C17.1 15.3 15.1 15.7 13.4 15.3 L10.4 18.3 C11.28 18.69 11.75 19.66 11.53 20.59 C11.3 21.53 10.44 22.17 9.48 22.12 C8.52 22.08 7.73 21.35 7.6 20.4 C7.21 21.28 6.24 21.75 5.31 21.53 C4.37 21.3 3.73 20.44 3.78 19.48 C3.82 18.52 4.55 17.73 5.5 17.6 L8.5 14.6 C8.1 12.9 8.5 10.9 10.1 9.3 C10.09 6.6 11.89 4.22 14.5 3.5 Z M13 8.5 C13.43 7.52 14.43 6.91 15.5 7",
  pantry: "M7.5 3.5 L16.5 3.5 L16.5 6.5 L7.5 6.5 Z M6.5 6.5 L17.5 6.5 C18.05 6.5 18.5 6.95 18.5 7.5 L18.5 19.5 C18.5 20.33 17.83 21 17 21 L7 21 C6.17 21 5.5 20.33 5.5 19.5 L5.5 7.5 C5.5 6.95 5.95 6.5 6.5 6.5 Z M9 12 L15 12 L15 16.5 L9 16.5 Z",
  drinks: "M6 7.5 L18 7.5 L16.6 19.7 C16.5 20.45 15.86 21.01 15.1 21 L8.9 21 C8.14 21.01 7.5 20.45 7.4 19.7 Z M6.6 12 L17.4 12 M13.5 7.5 L15.5 2.5 L18.5 2.5",
  snacks: "M6 3.5 L18 3.5 L17 6.5 L18 9.5 L17 12.5 L18 15.5 L17 18.5 L18 21 L6 21 L7 18.5 L6 15.5 L7 12.5 L6 9.5 L7 6.5 Z M10 10 L14 10 M10 14 L14 14",
  cleaning: "M8 10h7v11H8zM9.5 10V6.5h4V10M13.5 6.5l4-2.5M18.5 8.5h2M18.5 11.5h2M18.5 5.5h2",
  alcohol: "M7.5 3 L16.5 3 L16 9 C16 11.21 14.21 13 12 13 C9.79 13 8 11.21 8 9 Z M12 13 L12 20.5 M8.5 20.5 L15.5 20.5 M7.8 7 L16.2 7",
  baby: "M9.5 2.5 L14.5 2.5 M10 2.5 L10 5.5 L14 5.5 L14 2.5 M8 8.5 C7.61 7.84 7.63 7.01 8.06 6.37 C8.48 5.73 9.24 5.39 10 5.5 L14 5.5 C14.76 5.39 15.52 5.73 15.94 6.37 C16.37 7.01 16.39 7.84 16 8.5 L16 18.5 C16 19.88 14.88 21 13.5 21 L10.5 21 C9.12 21 8 19.88 8 18.5 Z M8 12 L11 12 M8 15.5 L11 15.5",
  breakfast: "M3.5 12 L20.5 12 C20.5 16.69 16.69 20.5 12 20.5 C7.31 20.5 3.5 16.69 3.5 12 Z M15 12 L19.5 4 M8 9.5 C9 8.7 10 8.7 11 9.5 C12 10.3 13 10.3 14 9.5",
  care: "M9 8.5 L15 8.5 L15 20.5 L9 20.5 Z M10.5 8.5 L10.5 6 L13.5 6 L13.5 8.5 M12 6 L12 3.5 L16 3.5 M9 13 L15 13",
  coffee: "M16.5 8.5 L18 8.5 C19.93 8.5 21.5 10.07 21.5 12 C21.5 13.93 19.93 15.5 18 15.5 L16.5 15.5 M3.5 8.5 L16.5 8.5 L16.5 16.5 C16.5 18.71 14.71 20.5 12.5 20.5 L7.5 20.5 C5.29 20.5 3.5 18.71 3.5 16.5 Z M7 2.5 L7 5.5 M10 2.5 L10 5.5 M13 2.5 L13 5.5",
  cooking: "M4.5 10.5 L19.5 10.5 L19.5 16.5 C19.5 18.71 17.71 20.5 15.5 20.5 L8.5 20.5 C6.29 20.5 4.5 18.71 4.5 16.5 Z M2.5 10.5 L4.5 10.5 M19.5 10.5 L21.5 10.5 M9 6.5 C9 5.5 10 5 10 4 M12 6.5 C12 5.5 13 5 13 4 M15 6.5 C15 5.5 16 5 16 4",
  cosmetics: "M9 11 L15 11 L15 20.5 L9 20.5 Z M10 11 L10 6.5 L14 3.5 L14 11 M9 15 L15 15",
  deli: "M4 11 L20 11 C20 15.42 16.42 19 12 19 C7.58 19 4 15.42 4 11 Z M8.5 7.5 C8.5 6 9.5 5 10.5 4.5 M12.5 7.5 C12.5 6 13.5 5 14.5 4.5 M3 11 L21 11",
  frozen: "M12 2.5 L12 21.5 M3.8 7.2 L20.2 16.8 M3.8 16.8 L20.2 7.2 M9.5 4.5 L12 6.5 L14.5 4.5 M9.5 19.5 L12 17.5 L14.5 19.5",
  health: "M9.5 3.5 L14.5 3.5 L14.5 9.5 L20.5 9.5 L20.5 14.5 L14.5 14.5 L14.5 20.5 L9.5 20.5 L9.5 14.5 L3.5 14.5 L3.5 9.5 L9.5 9.5 Z",
  home: "M3.5 10 L12 3.5 L20.5 10 L20.5 20.5 L3.5 20.5 Z M9.5 20.5 L9.5 15 L14.5 15 L14.5 20.5",
  other: "M5.5 5.5 L9.5 5.5 L9.5 9.5 L5.5 9.5 Z M14.5 5.5 L18.5 5.5 L18.5 9.5 L14.5 9.5 Z M5.5 14.5 L9.5 14.5 L9.5 18.5 L5.5 18.5 Z M14.5 14.5 L18.5 14.5 L18.5 18.5 L14.5 18.5 Z",
  paper: "M7 4.5 L17 4.5 C18.66 4.5 20 5.84 20 7.5 L20 16.5 C20 18.16 18.66 19.5 17 19.5 L7 19.5 C5.34 19.5 4 18.16 4 16.5 L4 7.5 C4 5.84 5.34 4.5 7 4.5 Z M7 4.5 C8.66 4.5 10 5.84 10 7.5 L10 19.5 M4 9.5 L7 9.5",
  pets: "M12 13 C14.6 13 17 15.6 17 18 C17 19.6 15.7 20.5 14.2 20.5 C13.2 20.5 12.8 20 12 20 C11.2 20 10.8 20.5 9.8 20.5 C8.3 20.5 7 19.6 7 18 C7 15.6 9.4 13 12 13 Z M6 10.5 C5.97 9.52 5.16 8.74 4.18 8.75 C3.19 8.76 2.4 9.57 2.4 10.55 C2.4 11.53 3.19 12.34 4.18 12.35 C5.16 12.36 5.97 11.58 6 10.6 M18 10.5 C17.97 9.52 17.16 8.74 16.18 8.75 C15.19 8.76 14.4 9.57 14.4 10.55 C14.4 11.53 15.19 12.34 16.18 12.35 C17.16 12.36 17.97 11.58 18 10.6 M9.5 6.5 C9.47 5.52 8.66 4.74 7.68 4.75 C6.69 4.76 5.9 5.57 5.9 6.55 C5.9 7.53 6.69 8.34 7.68 8.35 C8.66 8.36 9.47 7.58 9.5 6.6 M14.5 6.5 C14.47 5.52 13.66 4.74 12.68 4.75 C11.69 4.76 10.9 5.57 10.9 6.55 C10.9 7.53 11.69 8.34 12.68 8.35 C13.66 8.36 14.47 7.58 14.5 6.6",
};
/** אייקון קו בצבע הטקסט. filled = מלא (למשל לב פעיל) */
export const Icon = (props: { d: string; size?: number; label?: string; filled?: boolean }) => (
  <svg viewBox="0 0 24 24" width={props.size ?? 20} height={props.size ?? 20} aria-hidden={props.label ? undefined : "true"} role={props.label ? "img" : undefined} aria-label={props.label}
    class={props.d === P.fwd || props.d === P.back || props.d === P.arrow ? "ic ic-dir" : "ic"}>
    <path d={props.d} fill={props.filled || props.d === P.heart ? "currentColor" : "none"} stroke="currentColor" stroke-width={1.5} stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);
const DUO: Record<string, string> = {
  compare: P.chart, delivery: P.truck, globe: P.globe, heart: P.heartO, history: P.clock, list: P.list, savings: P.trendDown,
  split: P.route, stale: P.clock, store: P.store, swap: P.swap, verified: P.shield,
};
/** אייקון בשם (קטגוריה "cat-…" או אייקון ממשק) — אותה משפחת קו */
export const Duo = (props: { name: string; size?: number }) => {
  const d = props.name.startsWith("cat-") ? CAT_ICON[props.name.slice(4)] : DUO[props.name];
  return <Icon d={d ?? P.store} size={props.size ?? 20} />;
};

// ---------------------------------------------------------------- product tile: real photo (Open Food Facts) on white when we have one, otherwise a neutral tile with the category line icon
export interface PhotoCredit { src: string; by: string; license: string }
let photoIndex: Record<string, PhotoCredit> | null = null;
const photoReady = fetch(u("/img/p/index.json"))
  .then((r) => (r.ok ? r.json() : { images: {} }))
  .then((j) => { photoIndex = j.images ?? {}; return photoIndex!; })
  .catch(() => (photoIndex = {}));
/** קרדיט התמונה של מוצר, או null כשאין תמונה אמיתית */
export function usePhoto(barcode?: string): PhotoCredit | null {
  const [idx, setIdx] = useState(photoIndex);
  useEffect(() => { if (!idx) photoReady.then(setIdx); }, []);
  return (barcode && idx?.[barcode]) || null;
}
export function ProductArt(props: { name: string; barcode?: string; size?: "s" | "m" | "l"; badge?: string }) {
  const photo = usePhoto(props.barcode);
  const cat = categoryOf(props.name);
  const px = props.size === "s" ? 20 : props.size === "l" ? 56 : 32;
  return (
    <div class={`art ${props.size ?? "m"} ${photo ? "photo" : ""}`} aria-hidden="true">
      {photo
        ? <img class="ph" src={u(`/img/p/${props.barcode}.webp`)} alt="" loading="lazy" decoding="async" width={320} height={320} />
        : <Icon d={cat ? CAT_ICON[cat.id]! : P.cart} size={px} />}
      {props.badge && <span class="art-badge">{props.badge}</span>}
    </div>
  );
}
// ---------------------------------------------------------------- chains: neutral monogram, never logos
const initials = (name: string) => {
  const w = name.replace(/\(.*?\)/g, "").replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean);
  if (!w.length) return "?";
  return w.length > 1 ? w[0]![0]! + w[1]![0]! : w[0]!.slice(0, 2);
};
// לוגואים אמיתיים של הרשתות (Wikidata/Commons או האתר הרשמי, לזיהוי בלבד) על אריח לבן אחיד; בלי לוגו — מונוגרמה
let logoIndex: Record<string, unknown> | null = null;
const logoReady = fetch(u("/img/chains/index.json"))
  .then((r) => (r.ok ? r.json() : { logos: {} }))
  .then((j) => (logoIndex = j.logos ?? {}))
  .catch(() => (logoIndex = {}));
export function ChainLogo(props: { name: string; id?: string; size?: "s" | "m" }) {
  const [idx, setIdx] = useState(logoIndex);
  useEffect(() => { if (!idx) logoReady.then(setIdx); }, []);
  if (props.id && idx?.[props.id]) {
    return <span class={`chain-logo img ${props.size ?? "m"}`} aria-hidden="true"><img src={u(`/img/chains/${props.id}.webp`)} alt="" width={64} height={64} loading="lazy" decoding="async" /></span>;
  }
  return <span class={`chain-logo ${props.size ?? "m"}`} aria-hidden="true">{initials(props.name)}</span>;
}
// ---------------------------------------------------------------- quantity
export function Stepper(props: { name: string; qty: number; onSet: (n: number) => void; weighted?: boolean; wide?: boolean }) {
  return (
    <div class={`stepper ${props.wide ? "wide" : ""}`} role="group" aria-label={t("qtyOf", { name: props.name })}>
      <button class="step plus" onClick={() => props.onSet(props.qty + 1)} aria-label={t("addMore", { name: props.name })}><Icon d={P.plus} /></button>
      <span class="qty" aria-live="polite">{props.wide ? t("inCart", { n: props.qty }) : props.qty}{props.weighted ? (getLang() === "he" ? ' ק"ג' : " kg") : ""}</span>
      <button class="step minus" onClick={() => props.onSet(props.qty - 1)} aria-label={props.qty === 1 ? t("removeItem", { name: props.name }) : t("removeOne")}>
        <Icon d={props.qty === 1 ? P.trash : P.minus} />
      </button>
    </div>
  );
}

/** משוב הוספה: נקודה קטנה עפה מהכפתור אל הסל (בכותרת במחשב, בסרגל התחתון בטלפון) והסל "קופץ" */
export function flyToBasket(from: HTMLElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !from.animate) return;
  const targets = [...document.querySelectorAll<HTMLElement>(".tabbar .cart-ic, .cart-btn .cart-ic")].filter((x) => x.offsetParent);
  const to = targets[0];
  if (!to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const dot = document.createElement("span");
  dot.className = "fly-dot";
  dot.style.left = `${a.left + a.width / 2 - 6}px`;
  dot.style.top = `${a.top + a.height / 2 - 6}px`;
  document.body.appendChild(dot);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  dot.animate([
    { transform: "translate(0,0) scale(1)", opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(0.9)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0.2 },
  ], { duration: 520, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" }).finished.then(() => {
    dot.remove();
    to.animate([{ transform: "scale(1)" }, { transform: "scale(1.22)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
  }, () => dot.remove());
}

/** כפתור הוספה לסל או כמות, לפי מה שכבר בסל */
export function AddOrQty(props: { p: Product; wide?: boolean }) {
  const app = useApp();
  const qty = app.inBasket.get(props.p.barcode);
  if (qty) return <Stepper name={props.p.name} qty={qty} onSet={(n) => app.setQty(props.p.barcode, n)} wide={props.wide} weighted={props.p.is_weighted} />;
  return (
    <button class="btn add" onClick={(e) => { flyToBasket(e.currentTarget as HTMLElement); app.add(props.p); app.say(t("added", { name: props.p.name })); }} aria-label={t("addLabel", { name: props.p.name })}>
      <Icon d={P.plus} size={18} /> <span class="lbl">{t("addToCart")}</span>
    </button>
  );
}

export function Empty(props: { art: string; title: string; children?: ComponentChildren }) {
  return (
    <div class="empty-state">
      <Illus name={props.art === "no-results" ? "no-results" : props.art === "offline" ? "offline" : "empty-basket"} size={168} />
      <p class="es-title">{props.title}</p>
      {props.children}
    </div>
  );
}

/** שגיאת טעינה: מה קרה, למה, ומה עושים — עם ניסיון חוזר */
export function LoadError(props: { city?: string }) {
  return (
    <div class="empty-state" role="alert">
      <Illus name="offline" size={150} />
      <p class="es-title">{t("cityDataFail", { city: props.city ?? "" })}</p>
      <p class="muted small">{navigator.onLine ? t("retry") : t("offlineNoData")}</p>
      <button class="btn" onClick={() => location.reload()}><Icon d={P.clock} size={18} /> {t("retryBtn")}</button>
    </div>
  );
}
/** טעינה ראשונה של עיר: מה נטען ולמה זה לוקח רגע (פס בלי אחוזים — אין לנו נתון התקדמות אמיתי) */
export function CityLoading() {
  const app = useApp();
  const city = app.city;
  const entry = city.kind === "city" ? [...(app.index?.cities ?? []), ...(app.index?.areas ?? [])].find((c) => c.key === city.key) : null;
  const n = entry?.stores ?? app.index?.totals.stores;
  return (
    <div class="city-loading" role="status" aria-live="polite">
      <span class="logo"><Icon d={P.cart} size={22} /></span>
      <p class="cl-title">{t("loadingCity", { where: cityIn(city) })}</p>
      <span class="cl-bar" aria-hidden="true"><i /></span>
      {n ? <p class="muted small">{t("loadingHint", { s: n.toLocaleString() })}</p> : null}
    </div>
  );
}

export const Skeleton = (props: { kind?: "grid" | "list" | "tall"; label?: string }) =>
  props.kind === "grid"
    ? <div class="skeleton-grid" aria-busy="true" aria-label={props.label}><i /><i /><i /><i /></div>
    : <div class={`skeleton-list ${props.kind === "tall" ? "tall" : ""}`} aria-busy="true" aria-label={props.label}><i /><i /><i /></div>;

/** טעינה אסינכרונית עם מפתח: מחזיר null עד שיש תוצאה */
export function useAsync<T>(key: string, enabled: boolean, run: () => Promise<T>): { data: T | null; error: boolean; busy: boolean } {
  const [state, setState] = useState<{ key: string; data: T | null; error: boolean; busy: boolean }>({ key: "", data: null, error: false, busy: false });
  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    setState((s) => ({ ...s, busy: true }));
    run().then(
      (data) => { if (!cancelled) setState({ key, data, error: false, busy: false }); },
      (e) => { console.error(e); if (!cancelled) setState({ key, data: null, error: true, busy: false }); },
    );
    return () => { cancelled = true; };
  }, [key, enabled]);
  return { data: state.key === key || state.busy ? state.data : null, error: state.error, busy: state.busy };
}

export function storeOf(stores: StoreRow[] | null, chain_id: string, store_id: string) {
  return stores?.find((s) => s.chain_id === chain_id && s.store_id === store_id) ?? null;
}

export type { StoreRow };

/** FLIP: כשסדר הרשימה משתנה (למשל דירוג סניפים אחרי השלמה בחלופה), כל פריט מחליק למקומו החדש */
export function useFlip<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const now = new Map<string, number>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-flip]")) {
      const k = el.dataset.flip!;
      const top = el.getBoundingClientRect().top;
      now.set(k, top);
      const prev = last.current.get(k);
      if (!reduce && prev !== undefined && Math.abs(prev - top) > 2 && el.animate) {
        el.animate([{ transform: `translateY(${prev - top}px)` }, { transform: "none" }], { duration: 280, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
      }
    }
    last.current = now;
  }, [dep]);
  return ref;
}
