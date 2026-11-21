/** השוואת סופרמרקטים: כרטיסי סניף מדורגים, טבלת מוצר × סניף, ורמז לפיצול */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { rankStores, storeKey, type StoreResult } from "../../../src/shared/ranking.ts";
import { allPlans, buildMatrix, priceMap, savingVs, type PriceMap } from "../../../src/shared/optimize.ts";
import { t } from "../i18n.ts";
import { favChains, recordCompare, toggleFavChain } from "../local.ts";
import { play } from "../sounds.ts";
import { u,
  ChainLogo, cityIn, cityLabel, date, Duo, Empty, Icon, money, P, Price, ProductArt, useFlip, Stepper, packLabel, Skeleton, unitLabel, useApp, type BasketItem,
} from "../ui.tsx";
import type { PriceRow } from "../../../src/shared/ranking.ts";
import { productType } from "../../../src/shared/categories.ts";
import { unitPrice } from "../../../src/shared/units.ts";
import { useAsync, LoadError } from "../ui.tsx";
import { ShareBasket } from "./help.tsx";
import type { Product } from "../engine.ts";
import { ClubToggle, DealInfo, useDeals, type AppliedDeal, type PromoRow } from "../deals.tsx";
import { dealKey } from "../../../src/shared/promo.ts";

const engine = () => import("../engine.ts");

export function mapsUrl(s: StoreResult["store"]) {
  const q = [s.chain_name, s.store_name, s.address, s.city].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** סל › השוואה › תוכנית: איפה אני ומה הצעד הבא (הצעדים שעברו הם קישורים) */
export function Steps(props: { at: 0 | 1 | 2 }) {
  const items: [string, string][] = [[t("stepsCart"), u("/basket")], [t("stCompare"), u("/compare")], [t("plan"), u("/plan")]];
  return (
    <ol class="steps" aria-label={t("steps")}>
      {items.map(([label, href], i) => {
        const state = i < props.at ? "done" : i === props.at ? "now" : "";
        const inner = <><span class="n">{i < props.at ? <Icon d={P.check} size={14} /> : i + 1}</span> {label}</>;
        return [
          i > 0 && <li key={`b${i}`} class={`bar ${i <= props.at ? "done" : ""}`} aria-hidden="true" />,
          <li key={i} class={state} aria-current={i === props.at ? "step" : undefined}>{i < props.at ? <a href={href}>{inner}</a> : inner}</li>,
        ];
      })}
    </ol>
  );
}

const priceCache = new WeakMap<object, Map<string, Promise<{ prices: PriceRow[]; promos: PromoRow[] }>>>();
/** מחירי הסל והמבצעים: נטענים פעם אחת לכל סל ומשמשים את הדירוג, הטבלה והתוכניות.
 *  prices = אחרי מבצעים (לפי הכמויות שבסל); raw = המחירים הרגילים; deals = המבצע שהוחל בכל סניף+מוצר. */
export function useBasketPrices(basket: BasketItem[]) {
  const app = useApp();
  const [state, setState] = useState<{ key: string; prices: PriceRow[] | null; promos: PromoRow[] | null; error: boolean }>({ key: "", prices: null, promos: null, error: false });
  const key = basket.map((b) => b.barcode).sort().join(",");
  useEffect(() => {
    if (!app.ready || !app.stores || !key) return;
    let cancelled = false;
    (async () => {
      try {
        const t0 = performance.now();
        // כמה רכיבים (כותרת, סל, השוואה) מבקשים את אותם מחירים: שאילתה אחת לכל סל ולכל טעינת נתונים
        const ck = key + "|" + (app.stores!.length) + "|" + (app.chain ?? "");
        let job = priceCache.get(app.stores!)?.get(ck);
        if (!job) {
          job = engine().then(async (m) => {
            const codes = basket.map((b) => b.barcode);
            const [prices, promos] = await Promise.all([m.pricesFor(codes), m.promosFor(codes).catch(() => [] as PromoRow[])]);
            return { prices, promos };
          });
          let m = priceCache.get(app.stores!); if (!m) priceCache.set(app.stores!, (m = new Map()));
          m.set(ck, job);
          job.catch(() => m!.delete(ck));
        }
        const got = await job;
        (window as any).__lastCompareMs = Math.round(performance.now() - t0);
        if (!cancelled) setState({ key, prices: got.prices, promos: got.promos, error: false });
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ key, prices: null, promos: null, error: true });
      }
    })();
    return () => { cancelled = true; };
  }, [key, app.ready, app.stores]);
  const raw = state.key === key ? state.prices : null;
  const promos = state.key === key ? state.promos : null;
  const d = useDeals(raw, promos, basket);
  return { prices: d.prices, raw, promos, deals: d.applied, error: state.error };
}

/** גודל מנורמל להשוואת חלופה: אותו סוג מידה ובערך אותו גודל (±10%) */
function sizeOf(p: BasketItem | Product): { kind: string; size: number } {
  if (p.is_weighted) return { kind: "w", size: 1 };
  const u = unitPrice(1000, p);
  if (u) return u.per === "ליטר" ? { kind: "l", size: 1000 / u.ag } : { kind: "g", size: (1000 * 100) / u.ag };
  return { kind: "u", size: Number(p.quantity) || 1 };
}
const sameSize = (a: BasketItem | Product, b: BasketItem | Product) => {
  const x = sizeOf(a), y = sizeOf(b);
  return x.kind === y.kind && y.size >= x.size * 0.9 && y.size <= x.size * 1.1;
};

/** "אותו דבר" במילים: אחוזי שומן זהים, ומילת התיאור הראשונה (אחרי סוג המוצר) מופיעה גם בחלופה.
 *  "לחם אחיד" ≠ "לחם שחור", "קוטג' 5%" ≠ "קוטג' 9%". גודל ביצים: L = לארג' = גדול. */
const SYN: string[][] = [["l", "לארג", "גדול", "גדולות"], ["m", "מדיום", "בינוני", "בינוניות"], ["xl", "ענק", "ענקיות"], ["s", "קטן", "קטנות"]];
const SKIP = new Set(["גודל", "מארז", "קרטון", "בקרטון", "יח", "יחידות", "גרם", "גר", "ליטר", "לי", "קג", "מל", "מהדרין", "כשר"]);
const words = (s: string) => s.toLowerCase().replace(/["'׳״`]/g, "").split(/[\s\-/,.()]+/).filter(Boolean);
function sameKind(a: string, b: string): boolean {
  const pa = a.match(/\d+(\.\d+)?%/g)?.join(",") ?? "", pb = b.match(/\d+(\.\d+)?%/g)?.join(",") ?? "";
  if (pa !== pb) return false;
  const wa = words(a).slice(1), wb = new Set(words(b));
  const key = wa.find((w) => !/\d/.test(w) && w.length >= 1 && !SKIP.has(w));
  if (!key) return true;
  const syn = SYN.find((g) => g.includes(key));
  return syn ? syn.some((s) => wb.has(s)) : wb.has(key);
}

/** השלמה בחלופה דומה: למוצר שחסר בסניף, המוצר הזול באותו סניף מאותו סוג (המילה הראשונה בשם) ובאותו גודל.
 *  מסומן תמיד "חלופה" — לא מוצג כאילו זה אותו מוצר. */
const subCache = new WeakMap<object, Promise<{ rows: PriceRow[]; label: Map<string, string> }>>();
export const substOn = () => { try { return localStorage.getItem("sal.subst") === "1"; } catch { return false; } };
export function useSubstitutes(basket: BasketItem[], prices: PriceRow[] | null, on: boolean) {
  const app = useApp();
  const key = basket.map((b) => b.barcode).sort().join(",");
  return useAsync(`sub|${key}|${app.ready}|${!!prices}`, on && !!prices && app.ready, () => {
    // אותו מערך מחירים (מהמטמון של useBasketPrices) = אותה תוצאה; הסל, הכותרת וההשוואה חולקים חישוב אחד
    let job = subCache.get(prices!);
    if (!job) { job = computeSubs(basket, prices!); subCache.set(prices!, job); }
    return job;
  });
}
async function computeSubs(basket: BasketItem[], prices: PriceRow[]) {
  {
    const m = await engine();
    const have = new Set(prices!.map((p) => `${p.chain_id}|${p.store_id}|${p.barcode}`));
    const rows: PriceRow[] = [];
    const label = new Map<string, string>();
    for (const b of basket) {
      const type = productType(b.name);
      if (!type) continue;
      const cands = (await m.similar(type, b.barcode, 300)).filter((c) => sameSize(b, c) && sameKind(b.name, c.name));
      if (!cands.length) continue;
      const byBc = new Map(cands.map((c) => [c.barcode, c]));
      const best = new Map<string, PriceRow>();
      for (const pr of await m.pricesFor(cands.map((c) => c.barcode))) {
        const sk = `${pr.chain_id}|${pr.store_id}`;
        if (have.has(`${sk}|${b.barcode}`)) continue;
        const cur = best.get(sk);
        if (!cur || pr.price_ag < cur.price_ag) best.set(sk, pr);
      }
      for (const [sk, pr] of best) {
        rows.push({ barcode: b.barcode, chain_id: pr.chain_id, store_id: pr.store_id, price_ag: pr.price_ag });
        label.set(`${sk}|${b.barcode}`, byBc.get(pr.barcode)!.name);
      }
    }
    return { rows, label };
  }
}

export function Compare(props: { onBack: () => void }) {
  const app = useApp();
  const { basket, stores } = app;
  const { prices: exact, raw, promos, deals, error } = useBasketPrices(basket);
  const [subOn, setSubOn] = useState(substOn);
  const toggleSub = () => { const v = !subOn; setSubOn(v); try { localStorage.setItem("sal.subst", v ? "1" : "0"); } catch {} };
  // החלופות מחושבות מהמחירים הרגילים (אותו מערך בכל שינוי כמות → חישוב אחד)
  const subs = useSubstitutes(basket, raw, subOn);
  const subLabel = subOn ? subs.data?.label ?? null : null;
  const prices = useMemo(() => (exact && subOn && subs.data ? [...exact, ...subs.data.rows] : exact), [exact, subOn, subs.data]);
  const isSub = (chain: string, store: string, barcode: string) => subLabel?.get(`${chain}|${store}|${barcode}`);
  const names = useMemo(() => new Map(basket.map((b) => [b.barcode, b])), [basket]);
  // הכמויות משתנות בלי לטעון מחירים מחדש: החישוב מיידי
  const results = useMemo(() => (prices && stores ? rankStores(basket, stores, prices) : null), [prices, stores, basket]);
  const pm = useMemo<PriceMap | null>(() => (prices ? priceMap(prices) : null), [prices]);
  const plans = useMemo(() => (pm && stores && basket.length <= 40 ? allPlans(basket, stores, pm) : null), [pm, stores, basket]);
  const [open, setOpen] = useState<string | null>(null);
  const [bestOpen, setBestOpen] = useState(false);
  const flipRef = useFlip<HTMLOListElement>(results);
  const [shown, setShown] = useState(6);
  const [favs, setFavs] = useState(() => new Set(favChains().map((c) => c.id)));
  // סניפים של אותה רשת עם אותו מחיר לסל ואותם מוצרים (למשל 6 סניפי AMPM) — כרטיס אחד עם "ועוד N סניפים"
  const groups = useMemo(() => {
    if (!results) return null;
    const m = new Map<string, { r: StoreResult; others: StoreResult[] }>();
    for (const r of results) {
      const k = `${r.store.chain_id}|${r.total_ag}|${r.found}|${r.missing.map((x) => x.barcode).join(",")}`;
      const g = m.get(k);
      if (g) g.others.push(r); else m.set(k, { r, others: [] });
    }
    return [...m.values()];
  }, [results]);
  const best = results?.[0];
  const complete = results?.filter((r) => r.complete) ?? [];
  const priciest = complete.length > 1 ? complete[complete.length - 1]! : null;

  useEffect(() => {
    if (!results) return;
    if (best?.complete) play("best-price");
    recordCompare({
      city: cityLabel(app.city), items: basket.length, barcodes: basket.map((b) => b.barcode),
      best: best?.complete ? { chain: best.store.chain_name, store: best.store.store_name, total_ag: best.total_ag } : null,
    });
  }, [raw, subOn, subs.data]);

  const splitGain = plans ? savingVs(plans.split2, plans.single) : null;
  const updatedOf = (s: StoreResult["store"]) => (s as any).updated as string | undefined;
  const dealOf = (r: StoreResult, barcode: string): AppliedDeal | undefined => deals.get(dealKey(r.store.chain_id, r.store.store_id, barcode));
  const dealSaved = (r: StoreResult) => r.lines.reduce((s, l) => s + (dealOf(r, l.barcode)?.saved_ag ?? 0), 0);

  const lines = (r: StoreResult, id?: string) => (
    <ul class="lines" id={id}>
      {r.lines.map((l) => {
        const b = names.get(l.barcode);
        const sub = isSub(r.store.chain_id, r.store.store_id, l.barcode);
        const dl = sub ? undefined : dealOf(r, l.barcode);
        return (
          <li key={l.barcode} class="row">
            {b && <ProductArt name={b.name} barcode={b.barcode} size="s" />}
            <span class="grow">{b?.name || l.barcode}{l.qty !== 1 ? ` ×${l.qty}` : ""}
              {b && <span class="muted"> · {unitLabel(l.price_ag, b, app.market)}</span>}
              {sub && <span class="sub-tag"> {t("subAs", { name: sub })}</span>}
              {dl && <DealInfo d={dl} weighted={b?.is_weighted} />}
            </span>
            {dl && <s class="was">{money(Math.round(dl.regular_ag * l.qty), app.market)}</s>}
            <b class="num">{money(l.line_ag, app.market)}</b>
          </li>
        );
      })}
    </ul>
  );

  return (
    <section class="compare" aria-labelledby="cmp-title">
      <div class="cmp-head">
        <button class="btn ghost icon back" onClick={props.onBack} aria-label={t("backToCart")}><Icon d={P.back} /></button>
        <div class="grow">
          <h1 id="cmp-title">{t("whereTitle", { where: cityIn(app.city) })}</h1>
          {basket.length > 0 && <small class="muted">{t("nItems", { n: basket.length })}{results ? ` · ${t("storesChains", { s: results.length, c: new Set(results.map((r) => r.store.chain_id)).size })}` : ""}</small>}
        </div>
      </div>
      <Steps at={1} />
      {!basket.length && <Empty art="empty-cart" title={t("cartEmpty")}><a class="btn" href={u("/")}>{t("heroCta")}</a></Empty>}
      {error && <LoadError city={cityLabel(app.city)} />}
      {basket.length > 0 && !results && !error && <Skeleton kind="tall" label={t("compare")} />}
      {results && results.length === 0 && <Empty art="no-results" title={t("noneStores", { where: cityIn(app.city) })} />}
      {results && best && (
        <div class="cmp-grid">
          <div class="cmp-main">
            <div class={`summary-card ${best.complete ? "ok" : "partial"}`} aria-live="polite">
              {best.complete ? (
                <>
                  <div class="sc-top">
                    <span class="tag good"><Icon d={P.check} size={14} /> {t("bestBasket")}</span>
                    <small class="muted">{t("ofItems", { f: best.found, n: best.total_items })}</small>
                  </div>
                  <div class="sc-row">
                    <ChainLogo name={best.store.chain_name} id={best.store.chain_id} />
                    <div class="grow"><b class="sc-name">{best.store.chain_name} · {best.store.store_name}</b>
                      <small class="muted">{[best.store.address, updatedOf(best.store) ? t("updated", { t: date(updatedOf(best.store)!, app.market, true) }) : ""].filter(Boolean).join(" · ")}</small></div>
                  </div>
                  <div class="sc-nums">
                    <Price ag={best.total_ag} class="xl" animate />
                    {priciest && priciest.total_ag > best.total_ag && (
                      <div class="sc-save"><Price ag={priciest.total_ag - best.total_ag} class="good l" animate /><small class="muted">{t("vsPriciest", { name: priciest.store.chain_name })}</small></div>
                    )}
                  </div>
                  <p class="sr-only">{t("sumComplete", { c: complete.length, t: results.length, name: best.store.chain_name, p: money(best.total_ag, app.market) })}</p>
                  <div class="sc-actions">
                    <a class="btn dark" href={mapsUrl(best.store)} target="_blank" rel="noopener"><Icon d={P.nav} size={18} /> {t("navigateStore")}</a>
                    <button class="btn ghost" aria-expanded={bestOpen} onClick={() => setBestOpen(!bestOpen)}>{bestOpen ? t("hideDetails") : t("details")}</button>
                    <ShareBasket />
                  </div>
                  {bestOpen && lines(best)}
                </>
              ) : <p class="summary">{t("sumPartial", { n: basket.length })}</p>}
              {plans && (
                <a class="split-teaser" href={u("/plan")}>
                  <Icon d={P.route} size={20} />
                  <span class="grow">{splitGain && splitGain > 0 ? t("splitTeaser", { k: 2, p: money(splitGain, app.market) }) : t("splitNoGain")}</span>
                  <Icon d={P.fwd} size={18} />
                </a>
              )}
            </div>


            <EditBasket />
            {promos?.some((p) => p.club) && <ClubToggle />}
            {(subOn || complete.length < Math.max(3, results.length * 0.2)) && (
              <label class="sub-toggle panel">
                <span class="grow"><b>{t("subToggle")}</b><small class="muted">{subOn && subs.busy ? "…" : t("subHint")}</small></span>
                <input type="checkbox" role="switch" class="switch" checked={subOn} onChange={toggleSub} />
              </label>
            )}
            <div class="section-head"><div class="grow"><h2>{t("rankedStores")}</h2><small class="muted">{t("sumComplete", { c: complete.length, t: results.length, name: best.store.chain_name, p: money(best.total_ag, app.market) })}</small></div></div>
            <ol class="stores" ref={flipRef} aria-label={t("rankedStores")}>
              {groups!.slice(0, shown).map(({ r, others }, i) => {
                const id = storeKey(r.store.chain_id, r.store.store_id);
                const isOpen = open === id;
                const fav = favs.has(r.store.chain_id);
                const upd = updatedOf(r.store);
                return (
                  <li key={id} data-flip={id} style={{ "--i": Math.min(i, 8) }} class={`store-card ${r.complete ? "complete" : "partial"} ${i === 0 ? "best" : ""}`} data-testid="store-card" data-total={r.total_ag} data-complete={String(r.complete)}>
                    <div class="row top-row">
                      <span class="rank" aria-label={t("rank", { n: i + 1 })}>{i + 1}</span>
                      <ChainLogo name={r.store.chain_name} id={r.store.chain_id} />
                      <div class="grow">
                        <div class="sr-name"><span class="pname">{r.store.chain_name}</span>
                          {i === 0 && r.complete && <span class="tag good">{t("cheapest")}</span>}
                          {r.store.stale && <span class="tag warn"><Icon d={P.clock} size={13} /> {t("stale")}</span>}</div>
                        <div class="small muted">{r.store.store_name}{r.store.address ? ` · ${r.store.address}` : ""}</div>
                        {others.length > 0 && (
                          <div class="small muted also-at">{t("alsoAt", { n: others.length, names: others.slice(0, 3).map((o) => o.store.store_name).join(", ") + (others.length > 3 ? "…" : "") })}</div>
                        )}
                      </div>
                      <div class="total">
                        <Price ag={r.total_ag} class={i === 0 && r.complete ? "good" : ""} animate />
                        <div class={`cov ${r.complete ? "ok" : ""}`}>
                          {r.complete ? (r.total_ag > best.total_ag && best.complete ? `+${money(r.total_ag - best.total_ag, app.market)}` : t("allItems")) : `${r.found}/${r.total_items} · ${Math.round(r.coverage * 100)}%`}
                        </div>
                      </div>
                    </div>
                    {!r.complete && <div class="meter part" aria-hidden="true"><i style={{ width: `${Math.round(r.coverage * 100)}%` }} /></div>}
                    <div class="facts">
                      <span class="fact"><Icon d={P.check} size={14} /> {t("available", { f: r.found, n: r.total_items })}</span>
                      {r.missing.length > 0 && <span class="fact bad"><Icon d={P.close} size={14} /> {t("missingN", { n: r.missing.length })}</span>}
                      {dealSaved(r) > 0 && <span class="fact deal"><Icon d={P.tag} size={14} /> {t("dealSaved", { p: money(dealSaved(r), app.market) })}</span>}
                      <span class="fact"><Duo name="delivery" size={14} /> {t("delivery")}: {t("deliveryUnknown")}</span>
                      {upd && <span class={`fact ${r.store.stale ? "warn" : ""}`}><Duo name="stale" size={14} /> {r.store.stale ? t("stale") : t("updated", { t: date(upd, app.market, true) })}</span>}
                    </div>
                    {r.savings_ag > 0 && r.savings_ref && (
                      <div class="small save">
                        {t("saves", { p: money(r.savings_ag, app.market), store: r.savings_ref.store_name.startsWith(r.savings_ref.chain_name) ? r.savings_ref.store_name : `${r.savings_ref.chain_name} ${r.savings_ref.store_name}` })}
                        {!r.complete && t("sameItems")}
                      </div>
                    )}
                    {r.missing.length > 0 && (
                      <div class="small missing">
                        <b>{t("missing")}</b> {r.missing.map((m) => names.get(m.barcode)?.name || m.barcode).join(", ")}
                      </div>
                    )}
                    <div class="card-actions">
                      <button class="btn link-btn details-btn" aria-expanded={isOpen} aria-controls={`d-${i}`} onClick={() => setOpen(isOpen ? null : id)}>
                        {isOpen ? t("hideDetails") : t("details")} <Icon d={isOpen ? P.up : P.down} size={16} />
                      </button>
                    </div>
                    {isOpen && (
                      <div class="card-open" id={`d-${i}`}>
                        {lines(r)}
                        <div class="card-actions open">
                          <a class="btn ghost small nav-btn" href={mapsUrl(r.store)} target="_blank" rel="noopener"><Icon d={P.nav} size={16} /> {t("navigateStore")}</a>
                          <button class="btn icon ghost fav" aria-pressed={fav} aria-label={`${fav ? t("unfavorite") : t("favorite")}: ${r.store.chain_name}`}
                            onClick={() => { toggleFavChain(r.store.chain_id, r.store.chain_name); setFavs(new Set(favChains().map((c) => c.id))); }}>
                            <Icon d={fav ? P.heart : P.heartO} size={20} />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {groups!.length > shown && (
              <button class="btn outline wide" onClick={() => setShown((s) => s + 20)}>{t("moreStores", { n: groups!.length - shown })}</button>
            )}
            <div class="cmp-links">
              <a class="btn ghost" href="#cmp-table" data-inpage onClick={(e) => { e.preventDefault(); document.getElementById("cmp-table")?.scrollIntoView({ behavior: "smooth" }); }}><Icon d={P.grid} size={18} /> {t("tableTab")}</a>
              <a class="btn ghost" href={u("/plan")}><Icon d={P.route} size={18} /> {t("plansTab")}</a>
            </div>
            <p class="muted xs">{t("promoNote")} {t("notInclDelivery")}</p>
            {pm && <CompareTable key={subOn && subs.data ? "s" : "x"} results={results} pm={pm} names={names} isSub={isSub} deals={deals} />}
          </div>
          <section class="cmp-side panel" aria-label={t("bestDetail")}>
            <small class="muted">{t("bestDetail")}</small>
            <div class="row">
              <ChainLogo name={best.store.chain_name} id={best.store.chain_id} />
              <div class="grow">
                <b class="big">{best.store.chain_name}</b>
                <div class="small muted">{best.store.store_name}{best.store.address ? ` · ${best.store.address}` : ""}</div>
              </div>
            </div>
            {lines(best)}
            <div class="row total-row"><span class="grow">{t("total")}</span><b class="big num">{money(best.total_ag, app.market)}</b></div>
            <p class="muted xs"><Duo name="delivery" size={14} /> {t("notInclDelivery")} · {t("promoNote")}</p>
            <a class="btn cta" href={mapsUrl(best.store)} target="_blank" rel="noopener"><Icon d={P.pin} /> {t("navigateStore")}</a>
          </section>
        </div>
      )}
      {best && (
        <div class="pin-bar">
          <div class="pb-sum"><small class="muted one-line">{best.store.chain_name} · {best.store.store_name}</small><Price ag={best.total_ag} animate /></div>
          <a class="btn ghost" href={u("/plan")}>{t("plan")}</a>
          <a class="btn dark" href={mapsUrl(best.store)} target="_blank" rel="noopener"><Icon d={P.nav} size={18} /> {t("navigate")}</a>
        </div>
      )}
    </section>
  );
}

/** עריכת הסל בתוך דף ההשוואה: כמות, הסרה (עם ביטול) — בלי לחזור לדף הסל */
function EditBasket() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  return (
    <section class="panel edit-basket" aria-labelledby="eb-title">
      <button class="eb-head" aria-expanded={open} aria-controls="eb-list" onClick={() => setOpen(!open)}>
        <h2 id="eb-title" class="grow">{t("editBasket", { n: app.basket.length })}</h2>
        <Icon d={open ? P.up : P.down} size={18} />
      </button>
      {open && (
        <ul class="lines-list" id="eb-list">
          {app.basket.map((b) => (
            <li key={b.barcode} class="line">
              <ProductArt name={b.name} barcode={b.barcode} size="s" />
              <div class="grow"><a class="pname" href={u(`/product/${encodeURIComponent(b.barcode)}`)}>{b.name}</a><div class="muted small one-line">{[packLabel(b), b.manufacturer].filter(Boolean).join(" · ")}</div></div>
              <Stepper name={b.name} qty={b.qty} weighted={b.is_weighted} onSet={(n) => app.setQty(b.barcode, n)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** טבלת מוצר × סניף. ברירת מחדל: 4 הסניפים הראשונים בדירוג; אפשר לבחור אחרים. */
function CompareTable(props: { results: StoreResult[]; pm: PriceMap; names: Map<string, BasketItem>; isSub: (c: string, s: string, b: string) => string | undefined; deals: Map<string, AppliedDeal> }) {
  const app = useApp();
  const candidates = props.results.slice(0, 12);
  // ברירת מחדל: הסניף הטוב ביותר של כל רשת (כדי שהטבלה תשווה רשתות שונות), עד 4 (3 בטלפון)
  const [cols, setCols] = useState<string[]>(() => {
    const max = matchMedia("(min-width: 40rem)").matches ? 4 : 3;
    const seen = new Set<string>();
    const pick: string[] = [];
    for (const r of candidates) if (!seen.has(r.store.chain_id) && pick.length < max) { seen.add(r.store.chain_id); pick.push(storeKey(r.store.chain_id, r.store.store_id)); }
    for (const r of candidates) if (pick.length < max && !pick.includes(storeKey(r.store.chain_id, r.store.store_id))) pick.push(storeKey(r.store.chain_id, r.store.store_id));
    return pick;
  });
  const [pick, setPick] = useState(false);
  // רמז גלילה רק כשהטבלה באמת רחבה מהמסך
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 4);
    check();
    addEventListener("resize", check);
    return () => removeEventListener("resize", check);
  }, [cols.length]);
  const chosen = candidates.filter((r) => cols.includes(storeKey(r.store.chain_id, r.store.store_id)));
  const m = useMemo(() => buildMatrix(app.basket, chosen.map((r) => r.store), props.pm), [app.basket, cols, props.pm]);
  const minTotal = Math.min(...m.totals.filter((x) => x.complete).map((x) => x.total_ag));

  return (
    <section class="panel table-panel" id="cmp-table" aria-labelledby="tbl-title">
      <div class="panel-head">
        <Duo name="compare" size={28} />
        <div class="grow"><h2 id="tbl-title">{t("table")}</h2><small class="muted">{t("tableHint")}</small></div>
        <button class="btn ghost small" aria-expanded={pick} onClick={() => setPick(!pick)}>{t("pickColumns")}</button>
      </div>
      {pick && (
        <div class="col-picker">
          {candidates.map((r) => {
            const k = storeKey(r.store.chain_id, r.store.store_id);
            const on = cols.includes(k);
            return (
              <label key={k} class="check">
                <input type="checkbox" checked={on} disabled={!on && cols.length >= 5} onChange={() => setCols(on ? cols.filter((x) => x !== k) : [...cols, k])} />
                {r.store.chain_name} · {r.store.store_name}
              </label>
            );
          })}
        </div>
      )}
      <ul class="legend">
        <li><span class="sw cheap"><Icon d={P.check} size={12} /></span> {t("legendCheap")}</li>
        <li><span class="sw exp">▲</span> {t("legendExp")}</li>
        <li><span class="sw miss">—</span> {t("legendMissing")}</li>
        <li><Duo name="stale" size={16} /> {t("legendStale")}</li>
      </ul>
      {overflow && <p class="scroll-hint" aria-hidden="true"><Icon d={P.arrow} size={16} /> {t("tableScrollHint")}</p>}
      <div class={`table-scroll ${overflow ? "overflows" : ""}`} ref={scroller} tabIndex={0} role="region" aria-label={t("tableHint")}>
        <table class="cmp-table">
          <thead>
            <tr>
              <th scope="col" class="prod-col">{t("product")}</th>
              {m.stores.map((s) => (
                <th key={storeKey(s.chain_id, s.store_id)} scope="col">
                  <ChainLogo name={s.chain_name} id={s.chain_id} size="s" />
                  <span class="th-name">{s.chain_name}<small>{s.store_name}</small></span>
                  {s.stale && <Duo name="stale" size={14} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.rows.map((row) => {
              const b = props.names.get(row.barcode);
              return (
                <tr key={row.barcode}>
                  <th scope="row" class="prod-col"><span class="pn">{b?.name ?? row.barcode}</span>{row.qty !== 1 && <small class="muted"> ×{row.qty}</small>}</th>
                  {row.cells.map((c, i) => {
                    const sub = props.isSub(m.stores[i]!.chain_id, m.stores[i]!.store_id, row.barcode);
                    const dl = sub ? undefined : props.deals.get(dealKey(m.stores[i]!.chain_id, m.stores[i]!.store_id, row.barcode));
                    return (
                    <td key={i} class={c.price_ag === null ? "miss" : c.cheapest ? "cheap" : c.priciest ? "exp" : ""} title={sub ? t("subAs", { name: sub }) : undefined}>
                      {c.price_ag === null ? (
                        <span><span aria-hidden="true">—</span><span class="sr-only">{t("notSold")}</span></span>
                      ) : (
                        <>
                          {c.cheapest && <Icon d={P.check} size={14} label={t("legendCheap")} />}
                          {c.priciest && <span aria-label={t("legendExp")}>▲</span>}
                          <span class="num">{money(c.line_ag!, app.market)}</span>
                          {sub && <small class="sub-tag" aria-label={t("subAs", { name: sub })}>{t("subShort")}</small>}
                          {dl && <small class="deal-mark" title={dl.descr || undefined}>{t(dl.club ? "dealClub" : "deal")}</small>}
                        </>
                      )}
                    </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" class="prod-col">{t("total")}</th>
              {m.totals.map((x, i) => (
                <td key={i} class={x.complete && x.total_ag === minTotal ? "cheap total" : "total"}>
                  <b class="num">{money(x.total_ag, app.market)}</b>
                  <small class={x.complete ? "good-text" : "bad-text"}>{x.complete ? t("allItems") : t("missingN", { n: x.missing })}</small>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
