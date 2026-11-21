/** דף מוצר: מחיר בכל סניף, היסטוריית מחיר, חלופות מאותו סוג */
import { useEffect, useMemo, useState } from "preact/hooks";
import { categoryOf, productType } from "../../../src/shared/categories.ts";
import { unitKind, unitPrice } from "../../../src/shared/units.ts";
import { t } from "../i18n.ts";
import { favProducts, toggleFavProduct } from "../local.ts";
import { u,
  AddOrQty, catName, ChainLogo, usePhoto, date, go, Duo, Price, LoadError, Empty, Icon, money, P, packLabel, ProductArt, Skeleton, storeOf, unitLabel, useApp, useAsync,
} from "../ui.tsx";
import type { HistoryRow, Product } from "../engine.ts";
import { DealInfo, dealUnit } from "../deals.tsx";
import { bestDeals, dealKey, todayIso } from "../../../src/shared/promo.ts";

const engine = () => import("../engine.ts");

export function ProductPage(props: { barcode: string }) {
  const app = useApp();
  const prod = useAsync(`p|${props.barcode}|${app.ready}`, app.ready, async () => (await engine()).product(props.barcode));
  const prices = useAsync(`sp|${props.barcode}|${app.ready}`, app.ready, async () => (await engine()).storePrices(props.barcode));
  const hist = useAsync(`h|${props.barcode}|${app.ready}`, app.ready && !!app.index, async () => (await engine()).history(props.barcode, app.scope, app.index!.generatedAt));
  // מבצעים תקפים למוצר, בכל סניף: הטוב לכל הלקוחות והטוב למועדון
  const promos = useAsync(`pm|${props.barcode}|${app.ready}`, app.ready, async () => (await engine()).promosFor([props.barcode]).catch(() => []));
  const deals = useMemo(() => bestDeals(promos.data ?? [], todayIso()), [promos.data]);
  const p = prod.data;
  const alts = useAsync(`a|${props.barcode}|${!!p}`, !!p, async () => {
    const kind = unitKind(p!);
    if (!kind) return [] as Product[];
    const list = await (await engine()).similar(productType(p!.name), p!.barcode, 200);
    const up = (x: Product) => unitPrice(x.min_ag, x)!.ag;
    return list.filter((x) => unitKind(x) === kind).sort((a, b) => up(a) - up(b)).slice(0, 8);
  });
  const [fav, setFav] = useState(() => favProducts().some((f) => f.barcode === props.barcode));
  const [allPrices, setAllPrices] = useState(false);
  const photo = usePhoto(props.barcode);

  useEffect(() => { if (p) document.title = `${p.name} · ${t("brand")}`; }, [p?.barcode]);
  if (app.failed) return <LoadError city={""} />;
  // המחירים והמבצעים קובעים את גובה אזור המחיר: מציגים את הדף רק כשהם כאן, כדי שלא יידחף אחרי הציור
  const pending = (!prices.data && !prices.error) || (!promos.data && !promos.error);
  if (!p || pending) return prod.data === null && !prod.busy && app.ready ? <Empty art="no-results" title={t("notFound", { q: props.barcode, where: "" })} /> : <Skeleton kind="tall" />;

  // eff = המחיר ליחידה במבצע לכל הלקוחות (בלי תנאי קנייה) אם יש, אחרת המחיר הרגיל. הוא קובע את הסדר ואת "הכי זול".
  // מבצע עם תנאי קנייה ומבצע מועדון מוצגים בשורה, בלי לשנות את הסדר.
  const rows = (prices.data ?? []).map((r) => {
    const e = deals.get(dealKey(r.chain_id, r.store_id, r.barcode));
    const open = e?.open ?? null;
    const eff = open && !open.min_purchase_ag && dealUnit(open) < r.price_ag ? Math.round(dealUnit(open)) : r.price_ag;
    return { ...r, store: storeOf(app.stores, r.chain_id, r.store_id), open, club: e?.club ?? null, eff };
  }).filter((r) => r.store).sort((a, b) => a.eff - b.eff || a.price_ag - b.price_ag);
  const min = rows.length ? rows[0]!.eff : p.min_ag;
  const minReg = rows.length ? Math.min(...rows.map((r) => r.price_ag)) : p.min_ag;
  const max = rows.length ? Math.max(...rows.map((r) => r.price_ag)) : p.max_ag;
  const nDeals = rows.filter((r) => r.open || r.club).length;
  const myUnit = unitPrice(p.min_ag, p);
  const inCart = app.inBasket.has(p.barcode);
  const cat = categoryOf(p.name);
  const favBtn = (
    <button class="btn ghost icon fav" aria-pressed={fav} aria-label={fav ? t("unfavorite") : t("favorite")} onClick={() => setFav(toggleFavProduct(p.barcode, p.name))}>
      <Icon d={fav ? P.heart : P.heartO} />
    </button>
  );

  return (
    <article class="product-page">
      <div class="pp-bar">
        <button class="btn ghost icon back" onClick={() => history.length > 1 ? history.back() : go({ name: "home" })} aria-label={t("back")}><Icon d={P.back} /></button>
        <nav class="crumbs desk-only" aria-label={t("back")}>
          <a href={u("/")}>{t("home")}</a><Icon d={P.fwd} size={14} />
          {cat && <><a href={u(`/category/${cat.id}`)}>{catName(cat.id)}</a><Icon d={P.fwd} size={14} /></>}
          <span aria-current="page">{p.name}</span>
        </nav>
        <span class="grow" />
        {favBtn}
      </div>
      <div class="pp-top">
        <figure class="pp-art">
          <ProductArt name={p.name} barcode={p.barcode} size="l" />
          {photo && <figcaption class="muted xs photo-credit">{t("photoBy")} <a href={photo.src} target="_blank" rel="noopener">Open Food Facts</a> · {photo.license}</figcaption>}        </figure>
        <div class="pp-info">
          <h1>{p.name}</h1>
          <p class="muted">{[p.manufacturer, packLabel(p), t("barcode", { b: p.barcode })].filter(Boolean).join(" · ")}</p>
          <div class="pp-price">
            <div class="pp-main">
              <small class="muted">{t("fromPrice", { p: "" }).trim()}{rows[0] ? ` · ${rows[0].store!.chain_name} ${rows[0].store!.store_name}` : ""}</small>
              <span><Price ag={min} class={`xxl ${min < minReg ? "sale" : ""}`} />{min < minReg && <s class="was">{money(minReg, app.market)}</s>}</span>
              {min < minReg && rows[0]?.open && <div class="pp-deal"><DealInfo d={rows[0].open} weighted={p.is_weighted} /></div>}
            </div>
            <dl class="pp-facts">
              <div><dt>{t("priceRange")}</dt><dd class="num">{money(minReg, app.market)}{max !== minReg ? ` – ${money(max, app.market)}` : ""}</dd></div>
              {nDeals > 0 && <div><dt>{t("dealsFact")}</dt><dd class="num">{t("dealsFactN", { n: nDeals })}</dd></div>}
              {myUnit && <div><dt>{t("unitPrice")}</dt><dd class="num">{unitLabel(p.min_ag, p, app.market)}</dd></div>}
              <div><dt>{t("pricesAt")}</dt><dd class="num">{rows.length}</dd></div>
            </dl>
          </div>
          <div class="pp-actions">
            <AddOrQty p={p} />
            <span class="desk-only">{favBtn}</span>
          </div>
          {inCart && <a class="link" href={u("/compare")}>{t("findCheapest")} <Icon d={P.fwd} size={16} /></a>}
          <p class="note"><Icon d={P.info} size={18} /> <span>{photo ? t("noDescription") : <><span>{t("illustration")}</span>. {t("noDescription")}</>}</span></p>
        </div>
      </div>

      <section class="pp-alts" aria-labelledby="pal-title">
        <div class="section-head"><div class="grow"><h2 id="pal-title">{t("alternatives")}</h2><small class="muted">{t("altHint")}</small></div></div>
        {!alts.data ? <Skeleton /> : alts.data.length === 0 ? <p class="muted panel">{t("altNone")}</p> : (
          <ul class="alt-cards">
            {alts.data.map((a) => {
              const cheaper = myUnit && unitPrice(a.min_ag, a)!.ag < myUnit.ag;
              return (
                <li key={a.barcode} class="alt-card">
                  <a href={u(`/product/${encodeURIComponent(a.barcode)}`)} class="ac-link">
                    <ProductArt name={a.name} barcode={a.barcode} />
                    <b class="ac-name">{a.name}</b>
                    <small class="muted">{[packLabel(a), a.manufacturer].filter(Boolean).join(" · ")}</small>
                    <span class="alt-price"><small class="muted">{t("fromPrice", { p: "" }).trim()}</small> <Price ag={a.min_ag} /></span>
                    <small class={`num ${cheaper ? "good-text" : "muted"}`}>{unitLabel(a.min_ag, a, app.market)}</small>
                  </a>
                  {inCart ? (
                    <button class="btn ghost small" onClick={() => { app.replace(p.barcode, a); app.say(t("replaced", { name: a.name })); go({ name: "product", barcode: a.barcode }); }}>
                      <Icon d={P.swap} size={16} /> {t("replace")}
                    </button>
                  ) : <AddOrQty p={a} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div class="pp-cols">
        <section aria-labelledby="pa-title">
          <div class="section-head"><div class="grow"><h2 id="pa-title">{t("pricesAt")}</h2><small class="muted">{t("storesChains", { s: rows.length, c: new Set(rows.map((r) => r.chain_id)).size })}</small></div></div>
          {!prices.data ? <Skeleton /> : (
            <ol class="price-rows panel">
              {(allPrices ? rows : rows.slice(0, 8)).map((r) => (
                <li key={`${r.chain_id}|${r.store_id}`} class={r.eff === min ? "cheap" : ""}>
                  <ChainLogo name={r.store!.chain_name} id={r.store!.chain_id} size="s" />
                  <span class="grow"><b>{r.store!.chain_name}</b><small class="muted">{r.store!.store_name}</small>
                    {(r.open || r.club) && (
                      <span class="pr-deal">
                        {r.open && <DealInfo d={r.open} weighted={p.is_weighted} />}
                        {r.club && <DealInfo d={r.club} weighted={p.is_weighted} />}
                      </span>
                    )}
                  </span>
                  {r.store!.stale && <span class="tag warn"><Icon d={P.clock} size={14} /> {t("stale")}</span>}
                  {r.eff === min && <span class="tag good">{t("cheapest")}</span>}
                  <span class="pr-end">
                    <Price ag={r.eff} class={r.eff === min ? "good" : ""} />
                    {r.eff < r.price_ag ? <s class="was">{money(r.price_ag, app.market)}</s> : r.eff !== min && <small class="muted num">+{money(r.eff - min, app.market)}</small>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {rows.length > 8 && <button class="btn link-btn" aria-expanded={allPrices} onClick={() => setAllPrices(!allPrices)}>{allPrices ? t("hideDetails") : t("moreStores", { n: rows.length - 8 })} <Icon d={allPrices ? P.up : P.down} size={16} /></button>}
        </section>

        <div class="pp-side">
          <section aria-labelledby="ph-title">
            <div class="section-head"><h2 id="ph-title" class="grow">{t("history")}</h2></div>
            <div class="panel">{hist.busy && !hist.data ? <Skeleton /> : <PriceHistory rows={hist.data} />}</div>
          </section>

        </div>
      </div>
      <div class="pin-bar">
        <div class="pb-sum">
          <small class="muted">{inCart ? t("inCart", { n: app.inBasket.get(p.barcode)! }) : t("fromPrice", { p: "" }).trim()}</small>
          <Price ag={inCart ? minReg * app.inBasket.get(p.barcode)! : min} animate />
        </div>
        <AddOrQty p={p} />
        {inCart && <a class="btn dark pb-go" href={u("/basket")}>{t("cartTab")}</a>}
      </div>
    </article>
  );
}

/** גרף מחיר: הנמוך בכל נקודת זמן בין הסניפים. עם נקודה אחת: "לא השתנה מאז". */
export function PriceHistory(props: { rows: HistoryRow[] | null }) {
  const app = useApp();
  const series = useMemo(() => {
    if (!props.rows?.length) return null;
    // מחיר מינימלי בעיר לאורך זמן: לכל רגע, המינימום על המחיר האחרון הידוע בכל סניף
    // נקודה אחת ליום (סוף היום). בתוך יום הסניפים נטענים בשעות שונות, והמינימום על "מה שנטען עד עכשיו"
    // יצר קפיצה מזויפת בתחילת הגרף.
    const day = (s: string) => s.slice(0, 10);
    const days = [...new Set(props.rows.map((r) => day(r.since)))].sort();
    const sorted = [...props.rows].sort((a, b) => (a.since < b.since ? -1 : 1));
    const last = new Map<string, number>();
    const pts: { t: string; v: number }[] = [];
    let i = 0;
    for (const d of days) {
      for (; i < sorted.length && day(sorted[i]!.since) <= d; i++) last.set(`${sorted[i]!.chain_id}|${sorted[i]!.store_id}`, sorted[i]!.price_ag);
      pts.push({ t: d, v: Math.min(...last.values()) });
    }
    return pts;
  }, [props.rows]);
  if (props.rows === null) return <p class="muted">{t("historyNone")}</p>;
  if (!series?.length) return <p class="muted">{t("historyNone")}</p>;
  const vals = series.map((p) => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals), cur = vals[vals.length - 1]!;
  const changes = series.length - 1;
  if (changes === 0) return <p class="muted">{t("historyStart", { date: date(series[0]!.t, app.market) })}</p>;
  if (lo === hi) {
    // התאריך האחרון שבו המחיר הנמוך נקבע
    return <p class="history-flat"><Icon d={P.check} size={18} /> {t("unchangedSince", { date: date(series[series.length - 1]!.t, app.market) })}</p>;
  }
  const W = 320, H = 120, pad = 8;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (series.length - 1);
  // ציר עם מרווח של לפחות 10% מהמחיר, כדי ששינוי של כמה אגורות לא ייראה כמו צניחה
  const span = Math.max(hi - lo, hi * 0.1);
  const base = lo - (span - (hi - lo)) / 2;
  const y = (v: number) => H - pad - ((v - base) * (H - 2 * pad)) / span;
  const path = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const trend = cur < series[0]!.v ? "trendDown" : cur > series[0]!.v ? "trendUp" : "trendFlat";
  return (
    <div class="history">
      <p class={`trend ${trend}`}>{t(trend)}</p>
      <svg viewBox={`0 0 ${W} ${H}`} class="chart" role="img" aria-label={`${t("history")}: ${t(trend)}`}>
        <path d={`${path} L${x(series.length - 1)} ${H} L${x(0)} ${H} Z`} class="area" />
        <path d={path} class="line" />
        {series.map((p, i) => <circle key={p.t} cx={x(i)} cy={y(p.v)} r="3.5" class="dot"><title>{`${date(p.t, app.market)}: ${money(p.v, app.market)}`}</title></circle>)}
      </svg>
      <dl class="stats">
        <div><dt>{t("current")}</dt><dd class="num">{money(cur, app.market)}</dd></div>
        <div><dt>{t("lowest")}</dt><dd class="num good-text">{money(lo, app.market)}</dd></div>
        <div><dt>{t("highest")}</dt><dd class="num bad-text">{money(hi, app.market)}</dd></div>
      </dl>
    </div>
  );
}
