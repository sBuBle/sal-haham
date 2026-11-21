/** דף הבית, חיפוש (עם סינון ומיון) ורשת מוצרים */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CATEGORIES, categoryOf, SUBCATEGORIES, subcategoryOf } from "../../../src/shared/categories.ts";
import { OFFICIAL_BASKET, matches, priceBasket } from "../basket.ts";
import { unitKind, unitPrice } from "../../../src/shared/units.ts";
import { getLang, t } from "../i18n.ts";
import { estimate, useCheapestStore } from "./cart.tsx";
import { Illus, type IllusName } from "../illus.tsx";
import { u,
  addRecent, AddOrQty, catName, OTHER_CAT, ChainLogo, clearRecent, recentSearches, cityIn, cityLabel, Duo, Empty, go, Icon, money, P, packLabel, Price, ProductArt, Skeleton,
  unitLabel, useApp, useAsync, date, LoadError, CityLoading,
} from "../ui.tsx";
import type { Product } from "../engine.ts";
import type { StoreRow } from "../data.ts";
import { CardDeal, cardSale } from "../deals.tsx";

const engine = () => import("../engine.ts");

// ---------------------------------------------------------------- product grid
export function ProductGrid(props: { items: Product[]; busy?: boolean; query: string; label: string; results?: boolean; view?: "list" | "grid" }) {
  const app = useApp();
  // שני מוצרים שונים (ברקוד שונה) עם אותו שם, יצרן ואריזה — מוסיפים את סוף הברקוד כדי שאפשר יהיה להבדיל ביניהם
  const look = (p: Product) => `${p.name}|${p.manufacturer}|${packLabel(p)}`;
  const counts = new Map<string, number>();
  for (const p of props.items) counts.set(look(p), (counts.get(look(p)) ?? 0) + 1);
  return (
    <ul class={`grid ${props.view ? "view-" + props.view : ""} ${props.results ? "results" : ""} ${props.busy ? "stale" : ""}`} aria-label={props.label} aria-busy={!!props.busy} data-query={props.query}>
      {props.items.map((p, i) => (
        <li key={p.barcode} data-anchor={p.barcode} style={{ "--i": Math.min(i, 12) }} class={`product-card ${app.inBasket.has(p.barcode) ? "in" : ""}`}>
          <a class="pc-link" href={u(`/product/${encodeURIComponent(p.barcode)}`)} aria-label={p.name} tabIndex={-1}>
            <ProductArt name={p.name} barcode={p.barcode} />
          </a>
          <div class="pc-body">
            <a class="pname" href={u(`/product/${encodeURIComponent(p.barcode)}`)}>{p.name || p.barcode}</a>
            <div class="muted small one-line">{[packLabel(p), p.manufacturer].filter(Boolean).join(" · ")}</div>
            {(counts.get(look(p)) ?? 0) > 1 && !p.barcode.includes(":") && <div class="muted xs">{t("barcodeEnd", { b: p.barcode.slice(-4) })}</div>}
            <div class="pc-price">
              <small class="muted from">{t("fromPrice", { p: "" }).trim()}</small>
              {cardSale(p) ? <><Price ag={p.deal_ag!} class="sale" /><s class="was">{money(p.min_ag, app.market)}</s></> : <Price ag={p.min_ag} />}
              {!cardSale(p) && p.min_ag !== p.max_ag && <small class="muted num to">{t("to", { p: money(p.max_ag, app.market) })}</small>}
            </div>
            {!!p.n_deals && <div class="pc-deal"><CardDeal p={p} /></div>}
            <div class="muted xs pc-meta">{[unitLabel(cardSale(p) ? p.deal_ag! : p.min_ag, p, app.market), t("inStores", { n: p.n_stores })].filter(Boolean).join(" · ")}</div>
          </div>
          <div class="pc-act"><AddOrQty p={p} /></div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- home
const K_GUIDED = "sal.guided";
/** מדריך קצר לביקור ראשון: שלושה צעדים עם איורים. "הבנתי" מקטין אותו לרשימה קצרה */
function Guide() {
  const [full, setFull] = useState(() => { try { return localStorage.getItem(K_GUIDED) !== "1"; } catch { return true; } });
  const done = () => { try { localStorage.setItem(K_GUIDED, "1"); } catch {} setFull(false); document.getElementById("q")?.focus(); };
  const steps: [IllusName, string, string][] = [["step-build", t("guide1"), t("guide1d")], ["step-compare", t("guide2"), t("guide2d")], ["step-store", t("guide3"), t("guide3d")]];
  return (
    <section class={`panel guide ${full ? "full" : ""}`} aria-labelledby="guide-title">
      <h2 id="guide-title">{t("guideTitle")}</h2>
      <ol class="guide-steps">
        {steps.map(([art, title, desc], i) => (
          <li key={art}>
            {full && <Illus name={art} size={120} />}
            <span class="gs-n num">{i + 1}</span>
            <div><b>{title}</b><small class="muted">{desc}</small></div>
          </li>
        ))}
      </ol>
      <button class="btn cta" onClick={done}>{full ? t("guideOk") : t("heroCta")} <Icon d={P.arrow} size={18} /></button>
    </section>
  );
}

/** כרטיס הסל הכהה: הסל בסניף הזול, החיסכון מול היקר, והמעבר להשוואה */
function BasketSummary() {
  const app = useApp();
  const c = useCheapestStore();
  const units = app.basket.reduce((s, b) => s + b.qty, 0);
  const save = c?.full && c.priciest ? c.priciest.total_ag - c.full.total_ag : 0;
  return (
    <section class="sum-card" aria-labelledby="sum-title">
      <div class="sum-head">
        <h2 id="sum-title" class="grow">{t("yourCart")} · {t("cartSummary", { n: app.basket.length, u: units })}</h2>
        <a class="sum-edit" href={u("/basket")}>{t("edit")}</a>
      </div>
      <p class="sum-where">{!c ? "…" : c.full ? t("cheapestAt", { name: c.full.store.chain_name, store: c.full.store.store_name }) : t("noFullStore")}</p>
      <div class="sum-nums">
        <Price ag={c?.full ? c.full.total_ag : (c?.cheapestEach ?? estimate(app.basket))} class="xl" animate />
        {save > 0 && <div class="sum-save"><small>{t("possibleSave")}</small><Price ag={save} class="good" animate /></div>}
      </div>
      <a class="btn cta" href={u("/compare")}>{t("fullCompare")} <Icon d={P.arrow} size={18} /></a>
    </section>
  );
}

export function Home() {
  const app = useApp();
  const city = app.city;
  let entry = city.kind === "city" ? [...(app.index?.cities ?? []), ...(app.index?.areas ?? [])].find((c) => c.key === city.key) : null;
  if (!entry && app.chain && app.stores && app.index) entry = { key: "", name: "", slug: "", stores: app.stores.length, chains: 1 } as any;
  const popular = useAsync(`pop|${app.ready}`, app.ready, async () => (await engine()).staples(12));
  // סל המוצרים בפיקוח מחירים (צו הפיקוח): בכל סניף המוצר הזול שעונה על כל הגדרה
  const featured = useAsync(`feat|${app.ready}|${app.chain}`, app.ready && !!app.stores, async () => {
    const m = await engine();
    const all = await m.byFirstWords([...new Set(OFFICIAL_BASKET.flatMap((d) => d.first))]);
    const cands = new Map(OFFICIAL_BASKET.map((d) => [d.id, all.filter((p) => d.first.some((w) => p.name.startsWith(w)) && matches(d, p))]));
    const prices = await m.pricesFor([...new Set([...cands.values()].flat().map((p) => p.barcode))]);
    const priced = priceBasket(cands, prices);
    const storeBy = new Map(app.stores!.map((s) => [`${s.chain_id}|${s.store_id}`, s]));
    const perChain = new Map<string, { store: StoreRow; b: (typeof priced)[number] }>();
    for (const b of priced) {
      const store = storeBy.get(`${b.chain_id}|${b.store_id}`);
      if (!store) continue;
      const k = app.chain ? `${b.chain_id}:${b.store_id}` : b.chain_id;
      if (!perChain.has(k)) perChain.set(k, { store, b });
    }
    return { rows: [...perChain.values()].slice(0, 6), full: priced.length, cands };
  });
  const catCounts = useAsync(`cc|${app.ready}|${app.chain}`, app.ready, async () => {
    const m = await engine();
    return new Map(await Promise.all(CATEGORIES.map(async (c) => [c.id, await m.countFor(null, c)] as const)));
  });
  const [showItems, setShowItems] = useState(false);
  const addOfficial = () => {
    // לכל הגדרה: המוצר שנמכר בהכי הרבה סניפים
    for (const d of OFFICIAL_BASKET) {
      const p = [...(featured.data?.cands.get(d.id) ?? [])].sort((a, b) => b.n_stores - a.n_stores)[0];
      if (p && !app.inBasket.has(p.barcode)) app.add(p);
    }
    app.say(t("officialAdded"));
  };
  // מספר המוצרים בעיר/באזור שנבחרו (ולא במאגר של כל הארץ); עם סינון רשת — של הרשת
  const chainCount = useAsync(`cnt|${app.ready}|${app.chain}|${city.kind === "city" ? city.slug : "all"}`, app.ready && (!!app.chain || city.kind === "city"), async () => (await engine()).countProducts());
  if (entry && app.chain && app.stores) entry = { ...entry, stores: app.stores.length, chains: 1 };
  const nProducts = app.chain || city.kind === "city" ? chainCount.data : app.index?.totals.products;
  const he = getLang() === "he";
  const rows = featured.data?.rows ?? [];
  const first = rows[0]?.b.total_ag ?? 0;
  const max = rows.length ? rows[rows.length - 1]!.b.total_ag : 0;

  return (
    <div class="home">
      <div class={`home-top ${app.basket.length ? "has-basket" : ""}`}>
        <section class="hero" aria-labelledby="hero-title">
          <p class="eyebrow">{t("eyebrow", { where: cityLabel(city) })}</p>
          <h1 id="hero-title">{t("heroTitle")}</h1>
          <p class="hero-sub">{entry ? t("heroSub", { s: entry.stores, c: entry.chains, where: cityIn(city) }) : t("heroSub", { s: app.index?.totals.stores ?? "", c: app.index?.chains.length ?? "", where: cityIn(city) })} {t("noSignup")}</p>
          {popular.data && popular.data.length > 0 && (
            <div class="popular-q">
              <span class="muted">{t("popularSearches")}</span>
              {[...new Set(popular.data.map((p) => p.name.split(" ").slice(0, 2).join(" ")))].slice(0, 5).map((w) => (
                <a key={w} class="chip" href={u(`/search?q=${encodeURIComponent(w)}`)}>{w}</a>
              ))}
            </div>
          )}
          {app.index && (
            <dl class="kpis">
              <div><dd class="num">{(entry?.stores ?? app.index.totals.stores).toLocaleString()}</dd><dt>{he ? "סניפים" : "Stores"}</dt></div>
              <div><dd class="num">{entry?.chains ?? app.index.chains.length}</dd><dt>{he ? "רשתות" : "Chains"}</dt></div>
              <div><dd class="num">{nProducts != null ? nProducts.toLocaleString() : "…"}</dd><dt>{he ? "מוצרים" : "Products"}</dt></div>
              <div><dd class="num">{date(app.index.dataUpdatedAt, app.market, true)}</dd><dt>{he ? "עדכון אחרון" : "Last update"}</dt></div>
            </dl>
          )}
        </section>
        {app.basket.length > 0 ? <BasketSummary /> : <Guide />}
      </div>

      <div class="home-body">
        <section aria-labelledby="cats-title">
          <div class="section-head"><h2 id="cats-title" class="grow">{t("categories")}</h2><a class="link" href={u("/search")}>{t("all")} <Icon d={P.fwd} size={16} /></a></div>
          <ul class="cat-tiles">
            {CATEGORIES.map((c) => (
              <li key={c.id}>
                <a class="cat-tile" href={u(`/category/${c.id}`)}>
                  <span class="tile"><Duo name={`cat-${c.id}`} size={28} /></span>
                  <span class="ct-name">{catName(c.id)}</span>
                  {catCounts.data && <small class="muted">{t("nProducts", { n: (catCounts.data.get(c.id) ?? 0).toLocaleString() })}</small>}
                </a>
              </li>
            ))}
          </ul>
        </section>

        {app.failed && <LoadError city={cityLabel(city)} />}
        {!app.ready && !app.failed && <CityLoading />}
        {popular.data && popular.data.length > 0 && (
          <section aria-labelledby="pp-title">
            <div class="section-head"><h2 id="pp-title" class="grow">{t("popularProducts")}</h2><a class="link" href={u("/search")}>{t("all")} <Icon d={P.fwd} size={16} /></a></div>
            <ProductGrid items={popular.data.slice(0, 8)} query="popular" label={t("popularProducts")} view="grid" />
          </section>
        )}

        <div class="home-cols">
          <section class="featured" aria-labelledby="ft-title">
            <div class="section-head"><div class="grow"><h2 id="ft-title">{t("featured")}</h2><small class="muted">{t("featuredSub", { where: cityIn(city) })}</small></div></div>
            {!featured.data ? <Skeleton label={t("featured")} /> : rows.length === 0 ? (
              <p class="muted small">{t("officialNone")}</p>
            ) : (
              <>
                <ol class="bars panel">
                  {rows.map(({ store, b }, i) => (
                    <li key={store.chain_id + store.store_id} class={i === 0 ? "best" : ""}>
                      <ChainLogo name={store.chain_name} id={store.chain_id} size="s" />
                      <span class="bar-name">{store.chain_name}<small class="muted">{store.store_name}</small></span>
                      <span class="bar-diff muted num">{i === 0 ? t("cheapest") : `+${money(b.total_ag - first, app.market)}`}</span>
                      <span class="bar-track"><i style={{ width: `${Math.max(8, Math.round((b.total_ag / max) * 100))}%` }} /></span>
                      <Price ag={b.total_ag} class={i === 0 ? "good" : ""} />
                    </li>
                  ))}
                </ol>
                <div class="official-actions">
                  <button class="btn ghost" onClick={addOfficial}><Icon d={P.plus} size={18} /> {t("officialAdd")}</button>
                  <button class="btn link-btn" aria-expanded={showItems} onClick={() => setShowItems(!showItems)}>{t(showItems ? "officialHide" : "officialShow", { n: OFFICIAL_BASKET.length })}</button>
                </div>
                {showItems && (
                  <ul class="official-list panel">
                    {OFFICIAL_BASKET.map((d) => {
                      const best = rows[0]!.b.lines.find((l) => l.def.id === d.id)!;
                      return (
                        <li key={d.id}>
                          <span class="grow">{d.label}<small class="muted">{best.name}</small></span>
                          <span class="num">{money(best.price_ag, app.market)}</span>
                          {d.max && <small class="muted num">{t("officialMax", { p: money(Math.round(d.max * 100), app.market) })}</small>}
                        </li>
                      );
                    })}
                    <li class="muted small">{t("officialSource")}</li>
                  </ul>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="pc-title">
            <div class="section-head"><h2 id="pc-title" class="grow">{t("priceChanges")}</h2></div>
            <div class="panel changes"><span class="es-ic"><Icon d={P.clock} size={22} /></span><p class="muted small">{t("noChanges", { date: date(app.index?.dataUpdatedAt, app.market) })}</p></div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- search + filters
/** תת-המחלקה: מה שנשמר בבניית הנתונים, ואם אין — לפי השם */
const subOf = (catId: string, p: Product) => (p.sub !== undefined ? p.sub : subcategoryOf(catId, p.name)?.id ?? "");
type Sort = "rel" | "price" | "unit" | "stores";
interface Filters { brands: string[]; min: string; max: string; kind: "" | "mass" | "volume" | "unit"; chain: string; sort: Sort }
const NO_FILTERS: Filters = { brands: [], min: "", max: "", kind: "", chain: "", sort: "rel" };

export function Search(props: { q: string; cat: string | null; sub?: string | null }) {
  const app = useApp();
  const query = props.q.trim();
  const cat = props.cat ? CATEGORIES.find((c) => c.id === props.cat) ?? (props.cat === "other" ? OTHER_CAT : null) : null;
  const [debounced, setDebounced] = useState(query);
  useEffect(() => { const h = setTimeout(() => setDebounced(query), 150); return () => clearTimeout(h); }, [query]);
  // תת-קטגוריה (מילת מפתח של הקטגוריה): חיפוש לפי המילה, רק מוצרים מאותה קטגוריה
  const subs = cat ? SUBCATEGORIES[cat.id] ?? [] : [];
  const sub = !query && cat && props.sub ? subs.find((s) => s.id === props.sub) ?? null : null;
  const key = query ? `q|${debounced}` : cat ? `c|${cat.id}` : "";
  // כל התוצאות, לא רק 60: מציגים PAGE בכל פעם ("עוד מוצרים" / גלילה), וטוענים מהמנוע בקבוצות גדלות
  const PAGE = 60;
  const [limit, setLimit] = useState(300);
  const [page, setPage] = useState(PAGE);
  useEffect(() => { setLimit(300); setPage(PAGE); }, [key]);
  const res = useAsync(`${key}|${limit}|${app.ready}`, app.ready && !!key, async () => {
    const t0 = performance.now();
    const m = await engine();
    // קטגוריה: כל המוצרים שלה בבת אחת (עד כמה אלפים), בלי מוצרים שמילת המפתח שלהם הטעתה (למשל "דגני בוקר" בדגים)
    const r = query ? await m.search(debounced, limit) : await m.browse(cat!, 40000);
    (window as any).__lastSearchMs = Math.round(performance.now() - t0);
    return { key, items: r };
  });
  const total = useAsync(`n|${key}|${app.ready}`, app.ready && !!query, async () => (await engine()).countFor(query ? debounced : null, query ? null : cat));
  // טעינת "עוד" (אותו חיפוש, יותר תוצאות) לא מעמעמת את מה שכבר מוצג
  const busy = (res.busy && res.data?.key !== key) || (!!query && debounced !== query);
  // חיפוש שהחזיר תוצאות נשמר ב"חיפושים אחרונים" (במכשיר הזה בלבד), אחרי שהמשתמש הפסיק להקליד
  useEffect(() => {
    if (!query || !total.data) return;
    const h = setTimeout(() => addRecent(debounced), 1200);
    return () => clearTimeout(h);
  }, [debounced, total.data]);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [sheet, setSheet] = useState(false);
  const [view, setViewState] = useState<"list" | "grid" | undefined>(() => { try { return (localStorage.getItem("sal.view") as any) || undefined; } catch { return undefined; } });
  const setView = (v: "list" | "grid") => { setViewState(v); try { localStorage.setItem("sal.view", v); } catch {} };
  useEffect(() => setF(NO_FILTERS), [key]);

  // זמינות לפי רשת: מחירים אמיתיים של מוצרי התוצאה
  const items = res.data?.items ?? null;
  const chainsOf = useAsync(`ch|${res.data?.key}|${f.chain}`, !!items && !!f.chain, async () => {
    const pr = await (await engine()).pricesFor(items!.map((p) => p.barcode));
    const m = new Map<string, Set<string>>();
    for (const p of pr) { let s = m.get(p.barcode); if (!s) m.set(p.barcode, (s = new Set())); s.add(p.chain_id); }
    return m;
  });

  const brands = useMemo(() => {
    const c = new Map<string, number>();
    // יצרן ריק או זבל ("," / "משתנה" / "כללי") לא מוצג כמותג
    for (const p of items ?? []) if (p.manufacturer && /[א-תA-Za-z]{2}/.test(p.manufacturer) && !/^(משתנה|כללי|לא ידוע|שונות)$/.test(p.manufacturer.trim())) c.set(p.manufacturer, (c.get(p.manufacturer) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([b]) => b);
  }, [items]);

  const subCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (cat && !query) for (const p of items ?? []) { const s = subOf(cat.id, p); if (s) m.set(s, (m.get(s) ?? 0) + 1); }
    return m;
  }, [items, cat?.id, query]);
  const shown = useMemo(() => {
    if (!items) return null;
    const base = sub ? items.filter((p) => subOf(cat!.id, p) === sub.id) : items;
    const min = f.min ? Math.round(Number(f.min) * app.market.minor) : null;
    const max = f.max ? Math.round(Number(f.max) * app.market.minor) : null;
    let r = base.filter((p) =>
      (!f.brands.length || f.brands.includes(p.manufacturer)) &&
      (min === null || p.min_ag >= min) && (max === null || p.min_ag <= max) &&
      (!f.kind || (f.kind === "unit" ? unitKind(p) === null : unitKind(p) === f.kind)) &&
      (!f.chain || !chainsOf.data || chainsOf.data.get(p.barcode)?.has(f.chain)));
    const up = (p: Product) => unitPrice(p.min_ag, p)?.ag ?? Infinity;
    if (f.sort === "price") r = [...r].sort((a, b) => a.min_ag - b.min_ag);
    if (f.sort === "unit") r = [...r].sort((a, b) => up(a) - up(b));
    if (f.sort === "stores") r = [...r].sort((a, b) => b.n_stores - a.n_stores);
    return r;
  }, [items, f, chainsOf.data, sub?.id]);
  const active = f.brands.length + (f.min ? 1 : 0) + (f.max ? 1 : 0) + (f.kind ? 1 : 0) + (f.chain ? 1 : 0);
  // בלי מסננים: המספר האמיתי מהמנוע; עם מסננים: מה שנמצא במוצרים שנטענו
  const count = !active && total.data != null ? total.data : (shown?.length ?? 0);
  const moreInDb = !!items && items.length >= limit && (total.data == null || items.length < total.data);
  const visible = shown ? shown.slice(0, page) : null;
  // טעינה ראשונה: מצב הטעינה נשאר עד שהתוצאות הראשונות מגיעות (ולא נעלם כשהמנוע מוכן), כדי שהאזור לא יתכווץ ויתמלא שוב
  const everShown = useRef(false);
  if (shown) everShown.current = true;
  const firstLoad = !app.failed && (!app.ready || (!shown && !everShown.current && !res.error));
  const canMore = !!shown && (shown.length > page || moreInDb);
  const loadMore = () => {
    setPage((p) => p + PAGE);
    if (shown && page + PAGE >= shown.length && moreInDb) setLimit((l) => l * 2);
  };
  // גלילה עד סוף הרשימה טוענת עוד אוטומטית
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canMore || busy || res.busy) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [canMore, busy, res.busy, page, shown, limit]);

  const filterUi = (
    <div class="filters">
      <fieldset class="fld"><legend>{t("category")}</legend>
        <div class="chips">{CATEGORIES.map((c) => (
          <a key={c.id} class={`chip ${cat?.id === c.id ? "on" : ""}`} href={u(`/category/${c.id}`)}>{catName(c.id)}</a>
        ))}</div></fieldset>
      <fieldset class="fld"><legend>{t("price")}</legend>
        <div class="range">
          <input class="input" inputMode="decimal" placeholder={t("min")} aria-label={`${t("price")} ${t("min")}`} value={f.min} onInput={(e) => setF({ ...f, min: (e.target as HTMLInputElement).value })} />
          <input class="input" inputMode="decimal" placeholder={t("max")} aria-label={`${t("price")} ${t("max")}`} value={f.max} onInput={(e) => setF({ ...f, max: (e.target as HTMLInputElement).value })} />
        </div></fieldset>
      <fieldset class="fld"><legend>{t("size")}</legend>
        <div class="chips">{(["", "mass", "volume", "unit"] as const).map((k) => (
          <button key={k} class={`chip ${f.kind === k ? "on" : ""}`} aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{t(k ? (k === "unit" ? "units" : k) : "any")}</button>
        ))}</div></fieldset>
      <fieldset class="fld"><legend>{t("availability")}</legend>
        <select value={f.chain} onChange={(e) => setF({ ...f, chain: (e.target as HTMLSelectElement).value })} aria-label={t("availability")}>
          <option value="">{t("any")}</option>
          {/* רק רשתות שיש להן סניפים בעיר שנבחרה */}
          {(app.index?.chains ?? []).filter((c) => !app.stores || app.stores.some((s) => s.chain_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></fieldset>
      {brands.length > 0 && (
        <fieldset class="fld"><legend>{t("brand_")}</legend>
          <div class="checks">{brands.map((b) => (
            <label key={b} class="check"><input type="checkbox" checked={f.brands.includes(b)} onChange={() => setF({ ...f, brands: f.brands.includes(b) ? f.brands.filter((x) => x !== b) : [...f.brands, b] })} /> {b}</label>
          ))}</div></fieldset>
      )}
      {active > 0 && <button class="btn ghost small" onClick={() => setF({ ...NO_FILTERS, sort: f.sort })}>{t("clear")}</button>}
    </div>
  );

  const sorts: [Sort, string][] = [["rel", t("sortRel")], ["price", t("sortPrice")], ["unit", t("sortUnit")], ["stores", t("sortStores")]];
  const viewToggle = (
    <div class="view-toggle" role="group" aria-label={`${t("listView")} / ${t("gridView")}`}>
      <button class={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")} aria-label={t("listView")}><Icon d={P.list} /></button>
      <button class={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")} aria-label={t("gridView")}><Icon d={P.grid} /></button>
    </div>
  );

  if (!key) return (
    <section class="search-page browse" aria-labelledby="browse-title">
      <div class="section-head"><div class="grow"><h1 id="browse-title">{t("browseTitle")}</h1><small class="muted">{t("searchHint")}</small></div></div>
      <RecentChips />
      <ul class="cat-tiles">
        {[...CATEGORIES, OTHER_CAT].map((c) => (
          <li key={c.id}><a class="cat-tile" href={u(`/category/${c.id}`)}><span class="tile"><Duo name={`cat-${c.id}`} size={28} /></span><span class="ct-name">{catName(c.id)}</span></a>
            {(SUBCATEGORIES[c.id]?.length ?? 0) > 0 && <ul class="ct-subs">{SUBCATEGORIES[c.id]!.map((s2) => <li key={s2.id}><a href={u(`/category/${c.id}/${s2.id}`)}>{getLang() === "he" ? s2.name : s2.en}</a></li>)}</ul>}</li>
        ))}
      </ul>
    </section>
  );

  return (
    <section class="search-page" aria-label={t("search")}>
      <nav class="crumbs desk-only"><a href={u("/")}>{t("home")}</a><Icon d={P.fwd} size={14} /><a href={u("/search")}>{t("search")}</a><Icon d={P.fwd} size={14} />{cat && !query ? <>{sub ? <a href={u(`/category/${cat.id}`)}>{catName(cat.id)}</a> : <span>{catName(cat.id)}</span>}{sub && <><Icon d={P.fwd} size={14} /><span>{getLang() === "he" ? sub.name : sub.en}</span></>}</> : <span>{query}</span>}</nav>
      <div class="section-head">
        <div class="grow">
          {cat && !query ? <h1>{catName(cat.id)}{sub ? <span class="muted"> · {getLang() === "he" ? sub.name : sub.en}</span> : null}</h1> : <h1>{t("resultsFor", { q: query })}</h1>}
          {/* השורה תמיד תופסת את מקומה, גם לפני שהמספר ידוע */}
          <small class="muted">{shown && !busy ? <>{t("nProducts", { n: count.toLocaleString() })} {cityIn(app.city)}</> : " "}</small>
        </div>
        <div class="seg desk-only" role="group" aria-label={t("sort")}>
          <span class="seg-label">{t("sort")}</span>
          {sorts.map(([v, l]) => <button key={v} class={f.sort === v ? "on" : ""} aria-pressed={f.sort === v} onClick={() => setF({ ...f, sort: v })}>{l}</button>)}
        </div>
      </div>
      {cat && !query && (
        <div class="sub-chips" role="group" aria-label={catName(cat.id)}>
          <a class={`chip ${!sub ? "on" : ""}`} href={u(`/category/${cat.id}`)} aria-current={!sub ? "true" : undefined}>{t("allProducts")} {items && <small class="num">{items.length.toLocaleString()}</small>}</a>
          {subs.filter((s2) => !items || (subCounts.get(s2.id) ?? 0) > 0).map((s2) => (
            <a key={s2.id} class={`chip ${sub?.id === s2.id ? "on" : ""}`} href={u(`/category/${cat.id}/${s2.id}`)} aria-current={sub?.id === s2.id ? "true" : undefined}>
              {getLang() === "he" ? s2.name : s2.en} {items && <small class="num">{(subCounts.get(s2.id) ?? 0).toLocaleString()}</small>}
            </a>
          ))}
        </div>
      )}
      <div class="toolbar mob-only">
        <button class="chip filter-btn" onClick={() => setSheet(true)} aria-haspopup="dialog"><Icon d={P.filter} size={18} /> {t("filters")}{active ? <b class="num"> {active}</b> : ""}</button>
        <label class="chip sort-sel on"><span class="sr-only">{t("sort")}</span>
          <select value={f.sort} onChange={(e) => setF({ ...f, sort: (e.target as HTMLSelectElement).value as Sort })}>
            {sorts.map(([v, l]) => <option key={v} value={v}>{t("sort")}: {l}</option>)}
          </select><Icon d={P.down} size={16} /></label>
        {!cat && CATEGORIES.map((c) => <a key={c.id} class="chip" href={u(`/category/${c.id}`)}>{catName(c.id)}</a>)}
      </div>
      <div class="search-cols">
        <section class="filters-side" aria-label={t("filters")}>
          {cat && !query && (
            <nav class="sub-list" aria-label={t("subcategories")}>
              <h2 class="fs-title">{catName(cat.id)}</h2>
              <a class={!sub ? "on" : ""} href={u(`/category/${cat.id}`)} aria-current={!sub ? "page" : undefined}><span class="grow">{t("allProducts")}</span><small class="num">{items?.length.toLocaleString() ?? ""}</small></a>
              {subs.filter((s2) => !items || (subCounts.get(s2.id) ?? 0) > 0).map((s2) => (
                <a key={s2.id} class={sub?.id === s2.id ? "on" : ""} href={u(`/category/${cat.id}/${s2.id}`)} aria-current={sub?.id === s2.id ? "page" : undefined}><span class="grow">{getLang() === "he" ? s2.name : s2.en}</span><small class="num">{(subCounts.get(s2.id) ?? 0).toLocaleString()}</small></a>
              ))}
            </nav>
          )}
          <h2 class="fs-title">{t("filters")}</h2>{filterUi}</section>
        <div class="search-main">
          <div class="results-bar">
            {active > 0 && (
              <div class="active-filters" aria-label={t("activeFilters")}>
                {f.brands.map((b) => <button key={b} class="chip on" onClick={() => setF({ ...f, brands: f.brands.filter((x) => x !== b) })}>{b} <Icon d={P.close} size={14} /></button>)}
                {f.min && <button class="chip on" onClick={() => setF({ ...f, min: "" })}>{t("min")} {f.min} <Icon d={P.close} size={14} /></button>}
                {f.max && <button class="chip on" onClick={() => setF({ ...f, max: "" })}>{t("max")} {f.max} <Icon d={P.close} size={14} /></button>}
                {f.kind && <button class="chip on" onClick={() => setF({ ...f, kind: "" })}>{t(f.kind === "unit" ? "units" : f.kind)} <Icon d={P.close} size={14} /></button>}
                {f.chain && <button class="chip on" onClick={() => setF({ ...f, chain: "" })}>{app.index?.chains.find((c) => c.id === f.chain)?.name ?? f.chain} <Icon d={P.close} size={14} /></button>}
                <button class="btn link-btn" onClick={() => setF({ ...NO_FILTERS, sort: f.sort })}>{t("clearAll")}</button>
              </div>
            )}
            <span class="grow" />
            {viewToggle}
          </div>
          {app.failed && <LoadError city={cityLabel(app.city)} />}
          {firstLoad && <><CityLoading /><Skeleton kind="grid" label={t("loadingCity", { where: cityIn(app.city) })} /></>}
          {shown && (
            <>
              <p class="sr-only" aria-live="polite">{busy ? "…" : t("nProducts", { n: count })}</p>
              {shown.length === 0 && !busy ? (
                <Empty art="no-results" title={t("notFound", { q: query || catName(cat?.id ?? ""), where: cityIn(app.city) })} />
              ) : <ProductGrid items={visible!} busy={busy} query={query ? debounced : cat?.id ?? ""} label={t("search")} results={!!query} view={view} />}
              {canMore && (
                <div class="more-row" ref={sentinel}>
                  <p class="muted small">{t("shownOf", { a: visible!.length.toLocaleString(), b: count.toLocaleString() })}</p>
                  <button class="btn ghost" onClick={loadMore} disabled={res.busy}>{t("moreProducts")}</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {sheet && (
        <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div class="sheet" role="dialog" aria-modal="true" aria-label={t("filters")}>
            <div class="sheet-head"><h2 class="grow">{t("filters")}</h2><button class="btn icon ghost" onClick={() => setSheet(false)} aria-label={t("close")}><Icon d={P.close} /></button></div>
            {filterUi}
            <button class="btn cta" onClick={() => setSheet(false)}>{t("apply", { n: count })}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** חיפושים אחרונים: צ'יפים שמחזירים לחיפוש בלחיצה */
export function RecentChips(props: { onPick?: () => void }) {
  const [list, setList] = useState(recentSearches);
  if (!list.length) return null;
  return (
    <div class="recent">
      <span class="eyebrow">{t("recentSearches")}</span>
      <div class="chips">
        {list.map((q) => <a key={q} class="chip" href={u(`/search?q=${encodeURIComponent(q)}`)} onClick={props.onPick}><Icon d={P.clock} size={14} /> {q}</a>)}
        <button class="btn link-btn" onClick={() => { clearRecent(); setList([]); }}>{t("clearRecent")}</button>
      </div>
    </div>
  );
}

/** שדה החיפוש בכותרת: מעדכן את הכתובת (#/search?q=) בלי להעמיס היסטוריה */
export function useSearchBox(current: string) {
  const ref = useRef<HTMLInputElement>(null);
  const onInput = (v: string) => go({ name: "search", q: v, cat: null }, location.pathname.endsWith("/search"));
  return { ref, onInput, value: current };
}
