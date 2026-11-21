/** תוכנית קנייה: סניף אחד / סל מפוצל / איזון נוחות */
import { useMemo, useState } from "preact/hooks";
import { allPlans, convenientPlan, priceMap, savingVs, type Plan } from "../../../src/shared/optimize.ts";
import { t } from "../i18n.ts";
import { u, ChainLogo, cityIn, Duo, Empty, Icon, money, P, Price, ProductArt, Skeleton, useApp, type BasketItem, LoadError, CityLoading } from "../ui.tsx";
import { mapsUrl, Steps, useBasketPrices } from "./compare.tsx";
import { ShareBasket } from "./help.tsx";

type Strategy = "single" | "split" | "conv";

export function PlanPage() {
  const app = useApp();
  const { basket, stores } = app;
  const { prices, error } = useBasketPrices(basket);
  const plans = useMemo(() => (prices && stores ? allPlans(basket, stores, priceMap(prices)) : null), [prices, stores, basket]);
  const [strategy, setStrategy] = useState<Strategy>("split");
  const [k, setK] = useState<2 | 3>(2);
  const [stopCost, setStopCost] = useState(10); // במטבע השוק (שקלים)
  const names = useMemo(() => new Map(basket.map((b) => [b.barcode, b])), [basket]);

  const chosen: Plan | null = !plans ? null
    : strategy === "single" ? plans.single
    : strategy === "split" ? (k === 2 ? plans.split2 : plans.split3)
    : convenientPlan(plans, Math.round(stopCost * app.market.minor));
  const gain = plans && chosen ? savingVs(chosen, plans.single) : null;

  const strategies: { id: Strategy; title: string; desc: string; icon: string }[] = [
    { id: "single", title: t("stratSingle"), desc: t("stratSingleD"), icon: "store" },
    { id: "split", title: t("stratSplit"), desc: t("stratSplitD"), icon: "split" },
    { id: "conv", title: t("stratConv"), desc: t("stratConvD"), icon: "savings" },
  ];

  return (
    <section class="plan-page" aria-labelledby="plan-title">
      <div class="cmp-head">
        <a class="btn ghost back" href={u("/compare")}><Icon d={P.back} /> {t("compare")}</a>
        <div class="grow"><h1 id="plan-title">{t("planTitle")}</h1><small class="muted">{t("planSub")} {cityIn(app.city)}</small></div>
      </div>
      <Steps at={2} />
      {!basket.length && <Empty art="empty-cart" title={t("cartEmpty")}><a class="btn" href={u("/")}>{t("heroCta")}</a></Empty>}
      {error && <LoadError city={""} />}
      {basket.length > 0 && !plans && !error && <Skeleton kind="tall" />}
      {plans && (
        <>
          <div class="strategies" role="radiogroup" aria-label={t("plan")}>
            {strategies.map((s) => {
              const p = s.id === "single" ? plans.single : s.id === "split" ? (k === 2 ? plans.split2 : plans.split3) : convenientPlan(plans, Math.round(stopCost * app.market.minor));
              return (
                <button key={s.id} role="radio" aria-checked={strategy === s.id} class={`strategy ${strategy === s.id ? "on" : ""}`} onClick={() => setStrategy(s.id)}>
                  <Duo name={s.icon} size={30} />
                  <b>{s.title}</b>
                  <small class="muted">{s.desc}</small>
                  {p && <span class="num s-total">{money(p.total_ag, app.market)}</span>}
                  {p && <small class="muted">{p.stops.length === 1 ? t("oneStore") : t("storesInvolved", { n: p.stops.length })} · {t("coverage", { f: p.found, n: p.total_items })}</small>}
                </button>
              );
            })}
          </div>

          {strategy === "split" && (
            <div class="seg" role="group" aria-label={t("stratSplit")}>
              {([2, 3] as const).map((n) => <button key={n} class={k === n ? "on" : ""} aria-pressed={k === n} onClick={() => setK(n)}>{t("maxStores", { k: n })}</button>)}
            </div>
          )}
          {strategy === "conv" && (
            <div class="panel stop-cost">
              <label for="stop-cost"><b>{t("stopCost")}</b></label>
              <div class="row">
                <input id="stop-cost" type="range" min={0} max={60} step={1} value={stopCost} onInput={(e) => setStopCost(Number((e.target as HTMLInputElement).value))} />
                <b class="num">{money(stopCost * app.market.minor, app.market)}</b>
              </div>
              <small class="muted">{t("stopCostHint")}</small>
            </div>
          )}

          {chosen && (
            <div class="panel plan-card" aria-live="polite">
              <div class="panel-head"><Duo name="verified" size={28} /><h2 class="grow">{t("recommended")}</h2><span class="desk-only"><ShareBasket compact /></span>
                <b class="num big">{money(chosen.total_ag, app.market)}</b></div>
              <p class={`plan-gain ${gain && gain > 0 ? "good" : ""}`}>
                {gain === null ? t("notComparable") : gain > 0 ? t("vsSingle", { p: money(gain, app.market) }) : t("vsSingleNone")}
                {" · "}{chosen.stops.length === 1 ? t("oneStore") : t("storesInvolved", { n: chosen.stops.length })}
                {" · "}{t("coverage", { f: chosen.found, n: chosen.total_items })}
              </p>
              <ol class="stops">
                {chosen.stops.map((s, i) => (
                  <li key={`${s.store.chain_id}|${s.store.store_id}`} class="stop">
                    <div class="stop-head">
                      <span class="rank">{i + 1}</span>
                      <ChainLogo name={s.store.chain_name} id={s.store.chain_id} />
                      <div class="grow"><b>{s.store.chain_name}</b><small class="muted"> {s.store.store_name}{s.store.address ? ` · ${s.store.address}` : ""}</small></div>
                      <b class="num">{money(s.subtotal_ag, app.market)}</b>
                    </div>
                    <ul class="lines">
                      {s.lines.map((l) => {
                        const b = names.get(l.barcode) as BasketItem | undefined;
                        return <li key={l.barcode} class="row">{b && <ProductArt name={b.name} barcode={b.barcode} size="s" />}<span class="grow">{b?.name ?? l.barcode}{l.qty !== 1 ? ` ×${l.qty}` : ""}</span><span class="num">{money(l.line_ag, app.market)}</span></li>;
                      })}
                    </ul>
                    <a class="btn small outline" href={mapsUrl(s.store)} target="_blank" rel="noopener"><Icon d={P.pin} size={18} /> {t("navigate")}</a>
                  </li>
                ))}
              </ol>
              {chosen.missing.length > 0 && <p class="small missing"><b>{t("missing")}</b> {chosen.missing.map((m) => names.get(m.barcode)?.name ?? m.barcode).join(", ")}</p>}
              <p class="note warn-note"><Duo name="delivery" size={18} /> {t("deliveryNote")}</p>
              {plans.unlimited && plans.unlimited.stops.length > 3 && (
                <p class="muted small">{t("unlimited", { n: plans.unlimited.stops.length, p: money(plans.unlimited.total_ag, app.market) })}</p>
              )}
            </div>
          )}
        </>
      )}
      {chosen && (
        <div class="pin-bar">
          <div class="pb-sum"><small class="muted">{chosen.stops.length === 1 ? t("oneStore") : t("storesInvolved", { n: chosen.stops.length })}</small><Price ag={chosen.total_ag} animate /></div>
          <ShareBasket />
          {chosen.stops[0] && <a class="btn dark" href={mapsUrl(chosen.stops[0].store)} target="_blank" rel="noopener"><Icon d={P.nav} size={18} /> {chosen.stops.length > 1 ? t("navFirst") : t("navigate")}</a>}
        </div>
      )}
    </section>
  );
}
