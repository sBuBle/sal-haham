/** הסל: פאנל צד (בדפי החנות) ודף סל מלא */
import { useState } from "preact/hooks";
import { productType } from "../../../src/shared/categories.ts";
import { unitKind, unitPrice } from "../../../src/shared/units.ts";
import { t } from "../i18n.ts";
import { saveList } from "../local.ts";
import { u, cityLabel, Empty, Icon, money, P, packLabel, Price, ProductArt, Skeleton, Stepper, storeOf, unitLabel, useApp, useAsync, type BasketItem } from "../ui.tsx";
import { DealInfo, dealUnit, useClub, type PromoRow } from "../deals.tsx";
import { todayIso } from "../../../src/shared/promo.ts";
import { rankStores } from "../../../src/shared/ranking.ts";
import { Steps, substOn, useBasketPrices, useSubstitutes } from "./compare.tsx";
import { ShareBasket } from "./help.tsx";

const engine = () => import("../engine.ts");

const units = (b: BasketItem[]) => b.reduce((s, x) => s + x.qty, 0);
export const estimate = (b: BasketItem[]) => b.reduce((s, x) => s + x.min_ag * x.qty, 0);

/** המחיר האמיתי של הסל בסניף אחד: הסניף הזול שיש בו את כל הסל (כמו בדף ההשוואה).
 *  "estimate" לעומתו = כל מוצר במחיר הנמוך שלו בעיר, גם אם בסניפים שונים — תמיד נמוך יותר, ולא ניתן לקנות כך בסניף אחד. */
export function useCheapestStore() {
  const app = useApp();
  const items = app.basket;
  // exact = אחרי מבצעים (כמו בדף ההשוואה); raw = המחירים הרגילים, לחישוב החלופות
  const { prices: exact, raw } = useBasketPrices(items);
  // כמו בדף ההשוואה: אם הופעלה "השלמה בחלופה דומה", גם הסכום כאן כולל את החלופות
  const on = substOn();
  const subs = useSubstitutes(items, raw, on);
  if (!exact || !app.stores || !items.length || (on && !subs.data)) return null;
  const prices = on && subs.data ? [...exact, ...subs.data.rows] : exact;
  const ranked = rankStores(items, app.stores, prices);
  const full = ranked.find((r) => r.complete) ?? null;
  const complete = ranked.filter((r) => r.complete);
  const priciest = complete.length > 1 ? complete[complete.length - 1]! : null;
  return { full, priciest, nStores: ranked.length, cheapestEach: cheapestEach(items, prices) };
}
/** כל מוצר במחיר הנמוך שלו בסניפים הנוכחיים (מחושב מחדש, לא המחיר ששמור בסל מרגע ההוספה) */
function cheapestEach(items: BasketItem[], prices: { barcode: string; price_ag: number }[]) {
  const min = new Map<string, number>();
  for (const p of prices) if (!(p.price_ag >= (min.get(p.barcode) ?? Infinity))) min.set(p.barcode, p.price_ag);
  return Math.round(items.reduce((s, b) => s + (min.get(b.barcode) ?? b.min_ag) * b.qty, 0));
}

/** שורות הסיכום: הסל בסניף אחד (מה שבאמת משלמים), המינימום התאורטי, והפער מול היקר */
function Totals(props: { big?: boolean }) {
  const app = useApp();
  const c = useCheapestStore();
  const each = c?.cheapestEach ?? estimate(app.basket);
  const gap = c?.full && c.priciest ? c.priciest.total_ag - c.full.total_ag : 0;
  return (
    <div class={`totals ${props.big ? "big" : ""}`}>
      <div class="tot-main">
        <div class="grow">
          <small class="muted">{t("oneStoreTotal")}</small>
          {!c ? <b class="num">…</b> : c.full ? <Price ag={c.full.total_ag} class={props.big ? "xl" : "l"} animate /> : <b>{t("noFullStore")}</b>}
        </div>
        {c?.full && <small class="muted tot-store">{c.full.store.chain_name}<br />{c.full.store.store_name}</small>}
      </div>
      <div class="tot-row"><span class="grow">{t("eachCheapest")}</span><Price ag={each} animate /></div>
      {gap > 0 && <div class="tot-row"><span class="grow">{t("vsPriciest", { name: c!.priciest!.store.chain_name })}</span><Price ag={gap} class="good" animate /></div>}
      <p class="muted xs">{t("totalsHint")}</p>
    </div>
  );
}

/** הסכום בכותרת ובסרגל התחתון: הסל בסניף הזול, או "החל מ" עד שהוא מחושב */
export function CartTotalText() {
  const app = useApp();
  const c = useCheapestStore();
  if (!app.basket.length) return null;
  return <>{c?.full ? money(c.full.total_ag, app.market) : t("fromPrice", { p: money(c?.cheapestEach ?? estimate(app.basket), app.market) })}</>;
}

/** פאנל הסל בצד דפי החנות (במובייל: מתחת למוצרים) */
export function BasketPanel(props: { onCompare: () => void }) {
  const app = useApp();
  const items = app.basket;
  return (
    <section id="basket" class="basket panel" aria-label={t("cart")}>
      <div class="panel-head">
        <div class="grow">
          <h2>{items.length ? t("cartN", { n: items.length }) : t("cart")}</h2>
          {items.length > 0 && <small class="muted">{t("cartSummary", { n: items.length, u: units(items) })}</small>}
        </div>
        {items.length > 0 && <a class="link" href={u("/basket")}>{t("edit")}</a>}
      </div>
      {!items.length ? (
        <ol class="how">
          <li><span>1</span> {t("emptyHow1")}</li>
          <li><span>2</span> {t("emptyHow2")}</li>
          <li><span>3</span> {t("emptyHow3")}</li>
        </ol>
      ) : (
        <>
          <ul class="lines-list">
            {items.map((b) => (
              <li key={b.barcode} class="line">
                <ProductArt name={b.name} barcode={b.barcode} size="s" />
                <div class="grow">
                  <a class="pname" href={u(`/product/${encodeURIComponent(b.barcode)}`)}>{b.name || b.barcode}</a>
                  <div class="muted small one-line">{[packLabel(b), b.manufacturer].filter(Boolean).join(" · ")}</div>
                </div>
                <Stepper name={b.name} qty={b.qty} weighted={b.is_weighted} onSet={(n) => app.setQty(b.barcode, n)} />
              </li>
            ))}
          </ul>
          <div class="estimate"><Totals /></div>
          <button class="btn cta panel-cta" onClick={props.onCompare}>{t("findCheapest")} <Icon d={P.arrow} size={18} /></button>
        </>
      )}
    </section>
  );
}

/** סל ששותף בקישור (/basket?items=ברקוד*כמות,…): מוצג למעלה, ומתווסף לסל רק בלחיצה — אף פעם לא מחליף את הסל בשקט */
function SharedBasket() {
  const app = useApp();
  const [raw, setRaw] = useState(() => new URLSearchParams(location.search).get("items"));
  const wanted = (raw ?? "").split(",").map((x) => x.split("*")).filter(([bc]) => bc && /^[\w:.-]+$/.test(bc)).slice(0, 60).map(([bc, q]) => ({ bc: bc!, qty: Math.max(1, Math.min(99, Number(q) || 1)) }));
  const found = useAsync(`shared|${raw}|${app.ready}`, app.ready && wanted.length > 0, async () => {
    const m = await engine();
    const out: { p: NonNullable<Awaited<ReturnType<typeof m.product>>>; qty: number }[] = [];
    for (const w of wanted) { const p = await m.product(w.bc); if (p) out.push({ p, qty: w.qty }); }
    return out;
  });
  const close = () => {
    setRaw(null);
    const sp = new URLSearchParams(location.search); sp.delete("items");
    const rest = sp.toString();
    history.replaceState(history.state, "", location.pathname + (rest ? "?" + rest : ""));
  };
  if (!raw || !wanted.length) return null;
  return (
    <section class="panel shared-basket" aria-labelledby="sb-title" role="region">
      <h2 id="sb-title">{t("sharedBasket", { n: wanted.length })}</h2>
      <p class="muted small">{t("sharedBasketHint")}</p>
      {!found.data ? <Skeleton /> : (
        <ul class="lines-list">
          {found.data.map(({ p, qty }) => (
            <li key={p.barcode} class="line">
              <ProductArt name={p.name} barcode={p.barcode} size="s" />
              <div class="grow"><a class="pname" href={u(`/product/${encodeURIComponent(p.barcode)}`)}>{p.name}</a><div class="muted small one-line">{[packLabel(p), p.manufacturer].filter(Boolean).join(" · ")}</div></div>
              <span class="num">×{qty}</span>
            </li>
          ))}
          {found.data.length < wanted.length && <li class="muted small">{t("notFoundN", { n: wanted.length - found.data.length, where: cityLabel(app.city) })}</li>}
        </ul>
      )}
      <div class="sb-actions">
        <button class="btn" disabled={!found.data?.length} onClick={() => { for (const { p, qty } of found.data ?? []) if (!app.inBasket.has(p.barcode)) app.add(p, qty); app.say(t("sharedAdded", { n: found.data?.length ?? 0 })); close(); }}>{t("addShared")}</button>
        <button class="btn ghost" onClick={close}>{t("dismiss")}</button>
      </div>
    </section>
  );
}

/** דף הסל המלא */
export function CartPage(props: { onCompare: () => void }) {
  const app = useApp();
  const items = app.basket;
  const [listName, setListName] = useState("");
  const [savedOk, setSavedOk] = useState(false);
  const [saving, setSaving] = useState(false);
  // המבצע הטוב (מחיר ליחידה) לכל מוצר בסל, באיזה סניף שהוא; מבצעי מועדון רק אם ביקשו לכלול אותם
  const { promos } = useBasketPrices(items);
  const [club] = useClub();
  const bestDeal = new Map<string, PromoRow>();
  for (const d of promos ?? []) {
    if ((d.club && !club) || (d.ends && d.ends < todayIso())) continue;
    const cur = bestDeal.get(d.barcode);
    if (!cur || dealUnit(d) < dealUnit(cur)) bestDeal.set(d.barcode, d);
  }
  // חלופה זולה יותר ליחידה (אותו סוג ואותה יחידת מידה): רק רמז, ההחלפה בדף המוצר
  const cheaper = useAsync(`alt|${items.map((b) => b.barcode).join(",")}|${app.ready}`, app.ready && items.length > 0, async () => {
    const m = await engine();
    const out = new Set<string>();
    for (const b of items.slice(0, 25)) {
      const kind = unitKind(b);
      const mine = unitPrice(b.min_ag, b);
      if (!kind || !mine) continue;
      const sim = await m.similar(productType(b.name), b.barcode, 60);
      if (sim.some((x) => unitKind(x) === kind && unitPrice(x.min_ag, x)!.ag < mine.ag * 0.97)) out.add(b.barcode);
    }
    return out;
  });

  if (!items.length) return (
    <section class="cart-page"><div class="section-head"><h1>{t("cartTitle")}</h1></div>
      <SharedBasket />
      <Empty art="empty-cart" title={t("cartEmpty")}>
        <p class="muted small">{t("emptyHow1")}</p>
        <a class="btn" href={u("/search")}>{t("heroCta")}</a>
      </Empty>
    </section>
  );

  return (
    <section class="cart-page" aria-labelledby="cart-title">
      <div class="section-head">
        <div class="grow"><h1 id="cart-title">{t("cartTitle")}</h1><small class="muted">{t("cartSummary", { n: items.length, u: units(items) })}</small></div>
      </div>
      <Steps at={0} />
      <SharedBasket />
      <div class="cart-cols">
        <div class="cart-list">
          <div class="list-head">
            <span class="eyebrow grow">{t("products")}</span>
            <ShareBasket compact />
            <button class="btn link-btn danger" onClick={() => app.clear()}><Icon d={P.trash} size={16} /> {t("clearCart")}</button>
          </div>
          <ul class="cart-table panel">
            {items.map((b) => (
              <li key={b.barcode} class="cart-row">
                <ProductArt name={b.name} barcode={b.barcode} size="s" />
                <div class="grow">
                  <a class="pname" href={u(`/product/${encodeURIComponent(b.barcode)}`)}>{b.name}</a>
                  <div class="muted small">{[packLabel(b), b.manufacturer].filter(Boolean).join(" · ")}</div>
                  <div class="cr-price"><small class="muted">{t("fromPrice", { p: "" }).trim()}</small> <Price ag={b.min_ag * b.qty} />
                    {cheaper.data?.has(b.barcode) && <a class="tag good" href={u(`/product/${encodeURIComponent(b.barcode)}`)}><Icon d={P.swap} size={14} /> {t("cheaperAlt")}</a>}
                  </div>
                  <div class="muted xs">{unitLabel(b.min_ag, b, app.market)}</div>
                  {bestDeal.has(b.barcode) && (
                    <div class="cr-deal">
                      <DealInfo d={bestDeal.get(b.barcode)!} weighted={b.is_weighted} />
                      <small class="muted">{storeOf(app.stores, bestDeal.get(b.barcode)!.chain_id, bestDeal.get(b.barcode)!.store_id)?.chain_name ?? ""}</small>
                    </div>
                  )}
                </div>
                <Stepper name={b.name} qty={b.qty} weighted={b.is_weighted} onSet={(n) => app.setQty(b.barcode, n)} />
              </li>
            ))}
          </ul>
        </div>
        <div class="cart-sum">
          <div class="panel"><Totals big /></div>
          <button class="btn cta sum-cta" onClick={props.onCompare}>{t("cheapestStoreCta")} <Icon d={P.arrow} size={18} /></button>
          {!saving ? (
            <button class="btn link-btn save-toggle" onClick={() => { setSaving(true); setTimeout(() => document.getElementById("list-name")?.focus(), 30); }}>
              {savedOk ? <><Icon d={P.check} size={16} /> {t("saved")}</> : <><Icon d={P.list} size={16} /> {t("saveAsList")}</>}
            </button>
          ) : (
            <form class="save-list" onSubmit={(e) => {
              e.preventDefault();
              saveList(listName.trim() || new Date().toLocaleDateString(), items.map((b) => ({ barcode: b.barcode, name: b.name, qty: b.qty, data: b })));
              setSavedOk(true); setListName(""); setSaving(false); app.say(t("saved"));
            }}>
              <label class="sr-only" for="list-name">{t("listName")}</label>
              <input id="list-name" class="input" placeholder={t("listName")} value={listName} onInput={(e) => setListName((e.target as HTMLInputElement).value)} />
              <button class="btn ghost" type="submit">{t("saveList")}</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
