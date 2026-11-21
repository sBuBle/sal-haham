import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { CATEGORIES } from "../../src/shared/categories.ts";
import { marketById, type Lang } from "../../src/shared/market.ts";
import { fetchIndex, fetchStores, type SiteIndex, type StoreRow } from "./data.ts";
import { getLang, setLang, t } from "./i18n.ts";
import { getPrefs, setPrefs } from "./local.ts";
import { load, save } from "./storage.ts";
import { play } from "./sounds.ts";
import { u,
  AppCtx, catName, ChainLogo, cityIn, cityLabel, Duo, go, Icon, money, P, recentSearches, restoreScroll, useRoute,
  type BasketItem, type CityChoice, type Ctx,
} from "./ui.tsx";
import { Home, RecentChips, Search } from "./pages/shop.tsx";
import { ProductPage } from "./pages/product.tsx";
import { BasketPanel, CartPage, CartTotalText } from "./pages/cart.tsx";
import { Compare } from "./pages/compare.tsx";
import { PlanPage } from "./pages/plan.tsx";
import { AccountPage } from "./pages/account.tsx";
import { ChainPicker, CityPicker } from "./pages/picker.tsx";
import { HelpPage, NotFound, PrintList } from "./pages/help.tsx";
import type { Product, Scope } from "./engine.ts";

const Scanner = lazy(() => import("./scanner.tsx").then((m) => ({ default: m.Scanner })));
const engine = () => import("./engine.ts");

const K_CITY = "sal.city";
const K_BASKET = "sal.basket";
const K_CHAIN = "sal.chain";
const K_INSTALL_OFF = "sal.installDismissed";
/** מבקש מה-SW לשמור את כל מה שנטען (כולל ה-wasm וה-extension) לשימוש offline.
 *  נשלח כשהעיר מוכנה, ושוב כשה-SW מתחיל לשלוט בדף בביקור הראשון. */
function cacheLoaded() {
  navigator.serviceWorker?.controller?.postMessage({
    type: "cache-urls",
    urls: [...performance.getEntriesByType("resource").map((e) => e.name), ...((window as any).__duckdbFiles ?? [])]
      .filter((u: string) => u.startsWith(location.origin) || u.startsWith("https://extensions.duckdb.org/")),
  });
}
if (typeof navigator !== "undefined" && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("controllerchange", () => setTimeout(cacheLoaded, 500));
}

const toScope = (c: CityChoice): Scope => (c.kind === "all" ? { kind: "all" } : { kind: "city", slug: c.slug });

declare const __BUILD__: string;
export type { BasketItem };

export function App() {
  const [prefs, setPrefsState] = useState(getPrefs);
  const market = marketById(prefs.market);
  const [lang, setLangState] = useState<Lang>(() => prefs.lang ?? market.defaultLang);
  setLang(lang);
  const [index, setIndex] = useState<SiteIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [city, setCity] = useState<CityChoice | null>(() => load<CityChoice | null>(K_CITY, null));
  const [pickingCity, setPickingCity] = useState(() => !load<CityChoice | null>(K_CITY, null));
  const [allStores, setStores] = useState<StoreRow[] | null>(null);
  const [chainPick, setChainPick] = useState<string | null>(() => load<string | null>(K_CHAIN, null));
  // רשת שאין לה סניפים בעיר הנוכחית לא מסננת (אחרת האתר ריק); הבחירה נשמרת לעיר אחרת
  const chain = chainPick && allStores?.some((s) => s.chain_id === chainPick) ? chainPick : null;
  const stores = useMemo(() => (allStores && chain ? allStores.filter((s) => s.chain_id === chain) : allStores), [allStores, chain]);
  const cityChains = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    for (const s of allStores ?? []) {
      const c = m.get(s.chain_id) ?? { id: s.chain_id, name: s.chain_name, n: 0 };
      c.n++;
      m.set(s.chain_id, c);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "he"));
  }, [allStores]);
  const [scopeState, setScopeState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [basket, setBasket] = useState<BasketItem[]>(() => load<BasketItem[]>(K_BASKET, []));
  const [scanning, setScanning] = useState(false);
  const [qFocus, setQFocus] = useState(false);
  const [pickingChain, setPickingChain] = useState(false);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void }>({ msg: "" });
  const [online, setOnline] = useState(() => navigator.onLine);
  const [installEvt, setInstallEvt] = useState<any>(null);
  // "לא עכשיו" על הצעת ההתקנה נזכר במכשיר הזה
  const [installOff, setInstallOff] = useState(() => load<boolean>(K_INSTALL_OFF, false));
  const toastTimer = useRef(0);
  const route = useRoute();

  const say = (msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast({ msg: "" }), undo ? 5000 : 2600);
  };

  useEffect(() => {
    fetchIndex().then(setIndex).catch((e) => setIndexError(String(e?.message ?? e)));
    // מנוע ה-WASM נטען ברקע אחרי הציור הראשון
    const tm = setTimeout(() => engine().then((m) => m.warmup()).catch(() => {}), 50);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const bip = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    // "/" ממקד את החיפוש (כמו באתרים מוכרים); Esc מנקה אותו
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el?.closest?.("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) { const q = document.getElementById("q") as HTMLInputElement | null; if (q) { e.preventDefault(); q.focus(); q.select(); } }
      if (e.key === "Escape" && el?.id === "q") (el as HTMLInputElement).blur();
    };
    addEventListener("keydown", key);
    addEventListener("online", on);
    addEventListener("offline", off);
    addEventListener("beforeinstallprompt", bip);
    return () => {
      clearTimeout(tm);
      removeEventListener("online", on);
      removeEventListener("offline", off);
      removeEventListener("beforeinstallprompt", bip);
      removeEventListener("keydown", key);
    };
  }, []);

  // קישור משותף יכול לכלול עיר, רשת ושפה (?city=…&chain=…&lang=en): מי שפותח אותו רואה אותו דבר.
  // הבחירה נשמרת רק כי פתחו קישור כזה; אחרי ההחלה הפרמטרים יורדים מהכתובת
  useEffect(() => {
    if (!index) return;
    const sp = new URLSearchParams(location.search);
    const cityKey = sp.get("city"), chainId = sp.get("chain"), l = sp.get("lang");
    if (!cityKey && !chainId && !l) return;
    if (cityKey === "all") { setCity({ kind: "all" }); setPickingCity(false); }
    else if (cityKey) {
      const found = [...index.cities, ...(index.areas ?? [])].find((c) => c.key === cityKey);
      if (found) { setCity({ kind: "city", key: found.key, name: found.name, slug: found.slug }); setPickingCity(false); }
    }
    if (chainId) setChainPick(index.chains.some((c) => c.id === chainId) ? chainId : null);
    if (l === "he" || l === "en") changeLang(l);
    for (const k of ["city", "chain", "lang"]) sp.delete(k);
    const rest = sp.toString();
    history.replaceState(history.state, "", location.pathname + (rest ? "?" + rest : ""));
  }, [index]);

  // התאמת העיר השמורה לגרסת הנתונים הנוכחית
  useEffect(() => {
    if (!index || !city || city.kind === "all") return;
    const found = [...index.cities, ...(index.areas ?? [])].find((c) => c.key === city.key);
    if (!found) { setPickingCity(true); return; }
    if (found.slug !== city.slug) setCity({ ...city, slug: found.slug });
  }, [index]);

  useEffect(() => save(K_CITY, city), [city]);
  useEffect(() => save(K_BASKET, basket), [basket]);
  // שמירה גם ברגע היציאה מהדף (מעבר לכתובת אחרת מיד אחרי שינוי כמות)
  const basketRef = useRef(basket);
  basketRef.current = basket;
  useEffect(() => {
    const flush = () => save(K_BASKET, basketRef.current);
    addEventListener("pagehide", flush);
    addEventListener("beforeunload", flush);
    return () => { removeEventListener("pagehide", flush); removeEventListener("beforeunload", flush); };
  }, []);
  useEffect(() => save(K_CHAIN, chainPick), [chainPick]);

  // סינון רשת במנוע: כל הדפים קוראים מ-products/prices, אז מספיק לבנות אותם מחדש ולסמן "טוען"
  const loadSeq = useRef(0);
  const chainRef = useRef(chainPick);
  chainRef.current = chainPick;
  const engineChain = useRef<string | null>(null);
  useEffect(() => {
    if (scopeState !== "ready" || engineChain.current === chain) return;
    const seq = loadSeq.current;
    setScopeState("loading");
    engineChain.current = chain;
    engine().then((m) => m.setChain(chain)).then(
      () => { if (loadSeq.current === seq) setScopeState("ready"); },
      () => { if (loadSeq.current === seq) setScopeState("error"); });
  }, [chain, scopeState]);
  useEffect(() => { restoreScroll(); }, [route.name, (route as any).barcode, (route as any).cat, (route as any).sub]);
  // גובה הכותרת הדביקה, כדי ששורת תת-הקטגוריות תידבק מתחתיה
  useEffect(() => {
    const top = document.querySelector<HTMLElement>(".top");
    if (!top || !("ResizeObserver" in window)) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--sticky-top", `${top.offsetHeight}px`));
    ro.observe(top);
    return () => ro.disconnect();
  }, []);
  // כותרת הדף לפי המסך (לטאבים, היסטוריה וקוראי מסך)
  useEffect(() => {
    const names: Record<string, string> = { home: "", search: t("search"), product: "", cart: t("cartTitle"), compare: t("compare"), plan: t("plan"), account: t("account"), help: t("helpTitle"), notfound: t("nfTitle") };
    const page = pickingCity || !city ? t("pickTitle") : route.name === "search" && (route as any).q ? t("resultsFor", { q: (route as any).q }) : names[route.name] ?? "";
    if (route.name !== "product") document.title = page ? `${page} · ${t("brand")}` : `${t("brand")} · ${t("tagline")}`;
  }, [route, pickingCity, city, lang]);

  // טעינת נתוני העיר
  useEffect(() => {
    if (!index || !city || pickingCity) return;
    let cancelled = false;
    loadSeq.current++;
    setStores(null);
    setScopeState("loading");
    const scope = toScope(city);
    Promise.all([fetchStores(scope, index.generatedAt), engine().then((m) => m.loadScope(scope, index.generatedAt))])
      .then(async ([s]) => {
        const want = chainRef.current && s.some((x) => x.chain_id === chainRef.current) ? chainRef.current : null;
        await (await engine()).setChain(want);
        engineChain.current = want;
        if (cancelled) return;
        setStores(s);
        setScopeState("ready");
        cacheLoaded();
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        setScopeState("error");
      });
    return () => { cancelled = true; };
  }, [index, city, pickingCity]);

  // אחרי עדכון נתונים: פריט בסל שהמזהה שלו השתנה מוחלף במוצר עם אותו שם וגודל (ולא נעלם/"לא נמכר בשום סניף")
  const staleChecked = useRef("");
  useEffect(() => {
    if (scopeState !== "ready" || !index || !basket.length) return;
    const key = index.generatedAt + "|" + basket.map((b) => b.barcode).join(",");
    if (staleChecked.current === key) return;
    staleChecked.current = key;
    engine().then((m) => m.resolveStale(basket)).then((map) => {
      if (!map.size) return;
      setBasket((b) => {
        const seen = new Set<string>();
        return b.flatMap((x) => {
          const p = map.get(x.barcode);
          const n = p ? toItem(p, x.qty) : x;
          if (seen.has(n.barcode)) return [];
          seen.add(n.barcode);
          return [n];
        });
      });
      say(t("basketUpdated", { n: map.size }));
    }).catch(() => {});
  }, [scopeState, index, basket]);

  const inBasket = useMemo(() => new Map(basket.map((b) => [b.barcode, b.qty])), [basket]);
  const toItem = (p: Product | BasketItem, qty: number): BasketItem => {
    const { barcode, name, manufacturer, quantity, unit_qty, uom, is_weighted, min_ag } = p;
    return { barcode, name, manufacturer, quantity, unit_qty, uom, is_weighted, min_ag, qty };
  };
  const add = (p: Product | BasketItem, qty = 1) => {
    setBasket((b) => {
      const i = b.findIndex((x) => x.barcode === p.barcode);
      if (i >= 0) return b.map((x, j) => (j === i ? { ...x, qty: x.qty + qty } : x));
      return [...b, toItem(p, qty)];
    });
    play("add-to-cart");
  };
  const setQty = (barcode: string, qty: number) => {
    const cur = inBasket.get(barcode) ?? 0;
    if (qty < cur) play("remove"); else if (qty > cur) play("add-to-cart");
    if (qty <= 0) {
      // הסרה עם "ביטול": המוצר חוזר לאותו מקום בסל
      const idx = basket.findIndex((x) => x.barcode === barcode);
      const item = basket[idx];
      if (item) say(t("removedItem", { name: item.name }), () => setBasket((b) => b.some((x) => x.barcode === barcode) ? b : [...b.slice(0, idx), item, ...b.slice(idx)]));
    }
    setBasket((b) => (qty <= 0 ? b.filter((x) => x.barcode !== barcode) : b.map((x) => (x.barcode === barcode ? { ...x, qty } : x))));
  };
  const replace = (old: string, p: Product) =>
    setBasket((b) => {
      const cur = b.find((x) => x.barcode === old);
      if (!cur) return b;
      const idx = b.findIndex((x) => x.barcode === old);
      const rest = b.filter((x) => x.barcode !== old && x.barcode !== p.barcode);
      rest.splice(Math.min(idx, rest.length), 0, toItem(p, cur.qty));
      return rest;
    });

  const chooseCity = (c: CityChoice) => { setCity(c); setPickingCity(false); };
  const onScan = async (code: string): Promise<string> => {
    try {
      const m = await engine();
      if (city) await m.loadScope(toScope(city), index!.generatedAt);
      const p = await m.lookup(code);
      if (!p) return t("notFound", { q: code, where: cityIn(city) });
      play("scan-beep");
      add(p);
      say(t("added", { name: p.name }));
      return `נוסף: ${p.name}`;
    } catch {
      return "לא הצלחנו לחפש — נסו שוב";
    }
  };
  const openCompare = () => { if (basket.length) go({ name: "compare" }); };
  const changeLang = (l: Lang) => { setLangState(l); const p = { ...prefs, lang: l }; setPrefsState(p); setPrefs(p); };
  const changeMarket = (id: string) => { const p = { ...prefs, market: id }; setPrefsState(p); setPrefs(p); };

  const count = basket.length;
  const shopping = !pickingCity && !!city && !(indexError && !index);
  const shopView = route.name === "home" || route.name === "search" || route.name === "product";
  const ctx: Ctx | null = city ? {
    market, index, city, scope: toScope(city), ready: scopeState === "ready", failed: scopeState === "error", stores, chain, setChain: setChainPick,
    basket, inBasket, add, setQty, replace, clear: () => { const prev = basket; setBasket([]); say(t("cartCleared"), () => setBasket(prev)); }, setBasket, say, pickCity: () => setPickingCity(true),
  } : null;
  const q = route.name === "search" ? route.q : "";

  const page = () => {
    switch (route.name) {
      case "search": return <Search q={route.q} cat={route.cat} sub={route.sub ?? null} />;
      case "product": return <ProductPage barcode={route.barcode} />;
      case "cart": return <CartPage onCompare={openCompare} />;
      case "compare": return <Compare onBack={() => (history.length > 1 ? history.back() : go({ name: "cart" }))} />;
      case "plan": return <PlanPage />;
      case "account": return <AccountPage onLang={changeLang} />;
      case "help": return <HelpPage />;
      case "notfound": return <NotFound />;
      default: return <Home />;
    }
  };

  const tree = (
    <div class={`app ${shopping ? "shopping" : ""} ${shopping && (route.name === "search" && count > 0 || route.name === "product") ? "with-cart-bar" : ""} route-${route.name}`}>
      <a class="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>{getLang() === "he" ? "דילוג לתוכן" : "Skip to content"}</a>
      <header class="top">
        <div class={`top-row ${shopping && cityChains.length > 1 ? "has-chain" : ""}`}>
          <a class="brand" href={u("/")} aria-label={`${t("brand")}, ${t("home")}`}>
            <span class="logo"><Icon d={P.cart} size={20} /></span>
            <span>{t("brand")}</span>
          </a>
          {shopping && (
            <nav class="top-nav desk-only" aria-label={t("home")}>
              <a href={u("/")} class={route.name === "home" ? "on" : ""} aria-current={route.name === "home" ? "page" : undefined}>{t("home")}</a>
              <a href={u("/search")} class={route.name === "search" || route.name === "product" ? "on" : ""}>{t("categories")}</a>
              <a href={u("/compare")} class={route.name === "compare" || route.name === "plan" ? "on" : ""}>{t("compare")}</a>
            </nav>
          )}
          {shopping && (
            <div class="search-bar" role="search">
              <label for="q" class="sr-only">{t("searchLabel")}</label>
              <span class="search-ic"><Icon d={P.search} /></span>
              <input id="q" class="input" type="search" enterKeyHint="search" autocomplete="off" placeholder={t("searchPh")}
                value={q} onInput={(e) => go({ name: "search", q: (e.target as HTMLInputElement).value, cat: null }, route.name === "search")}
                onFocus={() => setQFocus(true)} onBlur={() => setTimeout(() => setQFocus(false), 180)} />
              {!q && <kbd class="kbd desk-only" aria-hidden="true">/</kbd>}
              {qFocus && !q && recentSearches().length > 0 && <div class="search-pop"><RecentChips onPick={() => setQFocus(false)} /></div>}
              {q && <button class="btn icon ghost clear-q" onClick={() => { go({ name: "search", q: "", cat: null }, true); document.getElementById("q")?.focus(); }} aria-label={t("clear")}><Icon d={P.close} /></button>}
              <button class="btn icon scan" onClick={() => setScanning(true)} aria-label={t("scan")}><Icon d={P.barcode} size={22} /></button>
            </div>
          )}
          <button class="city-btn" onClick={() => setPickingCity(true)} aria-label={t("cityBtn", { city: cityLabel(city) })}>
            <Icon d={P.pin} size={18} />
            <span class="city-txt">{cityLabel(city)}</span>
            <Icon d={P.down} size={16} />
          </button>
          {shopping && cityChains.length > 1 && (
            <button class={`chain-sel ${chain ? "on" : ""}`} onClick={() => setPickingChain(true)} aria-haspopup="dialog" aria-label={`${t("chainLabel")}: ${chain ? cityChains.find((c) => c.id === chain)?.name ?? "" : t("allChains")}`}>
              {chain ? <ChainLogo name={cityChains.find((c) => c.id === chain)?.name ?? ""} id={chain} size="s" /> : <Icon d={P.store} size={18} />}
              <span class="chain-txt">{chain ? cityChains.find((c) => c.id === chain)?.name : t("allChains")}</span>
              <Icon d={P.down} size={16} />
            </button>
          )}
          <div class="top-actions">
            {shopping && <a class="icon-link desk-only" href={u("/account")} aria-label={t("account")}><Icon d={P.user} /></a>}
            {shopping && (
              <a class="cart-btn desk-only" href={u("/basket")} aria-label={t("cartBtn", { n: count })}>
                <span class="cart-ic"><Icon d={P.cart} size={20} /></span><span>{t("cart")}</span>{count ? <b class="count num" key={count}>{count}</b> : null}
              </a>
            )}
          </div>
        </div>
        {shopping && (shopView || route.name === "notfound") && (
          <nav class="cats" aria-label={t("categories")}>
            <a class={`cat-chip ${route.name === "search" && !route.q && !route.cat ? "on" : ""}`} href={u("/search")}><Icon d={P.grid} size={18} /> {t("allCategories")}</a>
            {CATEGORIES.map((c) => {
              const on = route.name === "search" && route.cat === c.id && !route.q;
              return <a key={c.id} class={`cat-chip ${on ? "on" : ""}`} href={u(`/category/${c.id}`)} aria-current={on ? "page" : undefined}><Duo name={`cat-${c.id}`} size={18} /> {catName(c.id)}</a>;
            })}
          </nav>
        )}
      </header>

      <div class="banners">
        {!online && <div class="banner" role="status">{t("offline")}</div>}
        {shopping && chain && (
          <div class="banner chain-on" role="status">
            <span>{t("chainOnly", { name: cityChains.find((c) => c.id === chain)?.name ?? "" })}</span>
            <button class="btn small ghost" onClick={() => setChainPick(null)}>{t("showAllChains")}</button>
          </div>
        )}
      </div>

      {pickingChain && city && <ChainPicker chains={cityChains} current={chain} where={cityLabel(city)} onChoose={(id) => { setChainPick(id); setPickingChain(false); }} onCancel={() => setPickingChain(false)} />}
      {pickingCity && city && <CityPicker index={index} market={market} current={city} onMarket={changeMarket} onChoose={chooseCity} onCancel={() => setPickingCity(false)} />}
      <main id="main" tabIndex={-1}>
        {indexError && !index ? (
          <div class="empty" role="alert">
            <p>{t("loadFail")}</p>
            <p class="muted">{online ? t("retry") : t("offlineNoData")}</p>
          </div>
        ) : !city ? (
          <CityPicker index={index} market={market} onMarket={changeMarket} onChoose={chooseCity} />
        ) : shopView && route.name !== "home" ? (
          <div class="shop">
            <div class="shop-main">{page()}</div>
            <div class="shop-side"><BasketPanel onCompare={openCompare} /></div>
          </div>
        ) : page()}
      </main>
      {/* "נתוני בדיקה" (רק באתר הבדיקות) ידוע רק אחרי שהאינדקס נטען: תווית צפה, כדי לא לדחוף את הדף */}
      {index?.testData && <div class="banner warn test-data" role="note">{t("testData")}</div>}

      {shopping && route.name === "search" && count > 0 && (
        <div class="sticky-cta">
          <button class="cart-bar" disabled={!count} onClick={openCompare} aria-label={t("compareCta", { n: count })}>
            <Icon d={P.cart} size={24} />
            <span class="grow">
              <b>{count ? t("cartSummary", { n: count, u: basket.reduce((s, b) => s + b.qty, 0) }) : t("cartEmpty")}</b>
              <small>{count ? <CartTotalText /> : t("emptyHow1")}</small>
            </span>
            <span class="go">{t("compareShort")} <Icon d={P.fwd} size={18} /></span>
          </button>
        </div>
      )}

      {shopping && (
        <nav class="tabbar" aria-label={t("account")}>
          <a href={u("/")} class={route.name === "home" ? "on" : ""} aria-current={route.name === "home" ? "page" : undefined}><Icon d={P.home} size={22} /><span>{t("home")}</span></a>
          <a href={u("/search")} class={route.name === "search" || route.name === "product" ? "on" : ""} aria-current={route.name === "search" ? "page" : undefined}><Icon d={P.grid} size={22} /><span>{t("categoriesTab")}</span></a>
          <a href={u("/basket")} class={route.name === "cart" ? "on" : ""} aria-current={route.name === "cart" ? "page" : undefined}><span class="cart-ic" data-bump={count}><Icon d={P.cart} size={22} />{count ? <b class="count" key={count}>{count}</b> : null}</span><span>{t("cartTab")}</span></a>
          <a href={u("/compare")} class={route.name === "compare" || route.name === "plan" ? "on" : ""}><Icon d={P.chart} size={22} /><span>{t("compare")}</span></a>
          <a href={u("/account")} class={route.name === "account" ? "on" : ""} aria-current={route.name === "account" ? "page" : undefined}><Icon d={P.user} size={22} /><span>{t("accountTab")}</span></a>
        </nav>
      )}

      {scanning && (
        <Suspense fallback={<div class="scanner"><p class="scan-status">…</p></div>}>
          <Scanner onCode={onScan} onClose={() => setScanning(false)} />
        </Suspense>
      )}

      {shopping && (
        <footer class="site-foot desk-only">
          <span class="logo"><Icon d={P.cart} size={16} /></span><b>{t("brand")}</b>
          <span class="muted grow">· {t("promoNote")}</span>
          <a class="btn link-btn" href={u("/help")}>{t("helpTitle")}</a><span class="muted">·</span>
          <button class="btn link-btn" onClick={() => changeLang("en")}>English</button><span class="muted">·</span>
          <button class="btn link-btn" onClick={() => changeLang("he")}>עברית</button>
          <span class="muted build">{getLang() === "he" ? "גרסה" : "Version"} {__BUILD__}</span>
        </footer>
      )}

      {ctx && <PrintList />}
      {/* הצעת ההתקנה מגיעה מ-Chrome מתי שהוא רוצה, לרוב אחרי שהדף כבר צויר: כרטיס צף, לא בתוך הדף, כדי שהתוכן לא יידחף.
          לא מעל מסך בחירת העיר ולא מעל המדריך בדף הבית */}
      {installEvt && !installOff && shopping && !(route.name === "home" && count === 0) && (
        <div class="install-card" role="region" aria-label={t("installBtn")}>
          <span class="grow">{t("install")}</span>
          <button class="btn small" onClick={async () => { installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); }}>{t("installBtn")}</button>
          <button class="btn small ghost" onClick={() => { setInstallOff(true); save(K_INSTALL_OFF, true); }}>{t("dismiss")}</button>
        </div>
      )}
      <div class={`toast ${toast.msg ? "show" : ""}`} role="status" aria-live="polite">
        <span class="grow">{toast.msg}</span>
        {toast.undo && <button class="toast-undo" onClick={() => { toast.undo!(); setToast({ msg: "" }); }}>{t("undo")}</button>}
      </div>
    </div>
  );
  return ctx ? <AppCtx.Provider value={ctx}>{tree}</AppCtx.Provider> : tree;
}
