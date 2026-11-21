/** מבצעים בממשק: תג מבצע, תנאי המבצע במילים, תג לכרטיס מוצר, והעדפת "לכלול מבצעי מועדון" (נשמרת במכשיר) */
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import "./deals.css";
import { getLang, t } from "./i18n.ts";
import { Icon, money, P, useApp } from "./ui.tsx";
import { applyDeals, dealUnit, todayIso, type AppliedDeal, type Deal, type PromoRow } from "../../src/shared/promo.ts";
import type { BasketLine, PriceRow } from "../../src/shared/ranking.ts";
import type { Market } from "../../src/shared/market.ts";
import type { Product } from "./engine.ts";

// ---------------------------------------------------------------- club preference
const K_CLUB = "sal.club";
const EVT = "sal:club";
export const clubOn = () => { try { return localStorage.getItem(K_CLUB) === "1"; } catch { return false; } };
/** כל הרכיבים (סל, כותרת, השוואה, תוכנית) מתעדכנים יחד כשההעדפה משתנה */
export function useClub(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(clubOn);
  useEffect(() => {
    const h = () => setOn(clubOn());
    addEventListener(EVT, h);
    return () => removeEventListener(EVT, h);
  }, []);
  return [on, (v: boolean) => { try { localStorage.setItem(K_CLUB, v ? "1" : "0"); } catch {} setOn(v); dispatchEvent(new Event(EVT)); }];
}

/** מחירי הסל אחרי מבצעים (לפי הכמויות שבסל וההעדפה למועדון) + המבצע שהוחל בכל סניף+מוצר */
export function useDeals(raw: PriceRow[] | null, promos: PromoRow[] | null, basket: BasketLine[]): { prices: PriceRow[] | null; applied: Map<string, AppliedDeal> } {
  const [club] = useClub();
  const qtyKey = basket.map((b) => `${b.barcode}*${b.qty}`).join(",");
  return useMemo(() => {
    if (!raw) return { prices: null, applied: new Map<string, AppliedDeal>() };
    return applyDeals(raw, promos ?? [], basket, { club, today: todayIso() });
  }, [raw, promos, qtyKey, club]);
}

// ---------------------------------------------------------------- wording
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

/** "2 ב-₪24.00" או "₪9.90" (במוצר שקיל: לק"ג) */
export function dealPrice(d: Pick<Deal, "min_qty" | "total_ag">, m: Market, weighted?: boolean): string {
  const kg = weighted ? (getLang() === "he" ? ' לק"ג' : " / kg") : "";
  if (d.min_qty > 1) return t("dealNforX", { n: qtyText(d.min_qty) + (weighted ? (getLang() === "he" ? ' ק"ג' : " kg") : ""), p: money(d.total_ag, m) });
  return money(d.total_ag, m) + kg;
}

const shortDate = (iso: string) => {
  const [y, mo, d] = iso.split("-").map(Number);
  return y && mo && d ? `${d}.${mo}` : iso;
};

/** תנאי המבצע: מועדון, מגבלת כמות, "בקנייה מעל", תאריך סיום (רק אם הוא בחצי השנה הקרובה) */
export function dealTerms(d: Deal, m: Market, weighted?: boolean): string[] {
  const out: string[] = [];
  if (d.club) out.push(t("dealClubOnly"));
  if (d.min_purchase_ag) out.push(t("dealMinPurchase", { p: money(d.min_purchase_ag, m) }));
  if (d.max_qty) out.push(t(weighted ? "dealMaxKg" : "dealMax", { n: qtyText(d.max_qty) }));
  if (d.ends) {
    const days = (new Date(d.ends + "T23:59:59").getTime() - Date.now()) / 86400000;
    if (days < 183) out.push(t("dealUntil", { d: shortDate(d.ends) }));
  }
  return out;
}

// ---------------------------------------------------------------- components
export function DealTag(props: { club?: boolean; children?: ComponentChildren; title?: string }) {
  return (
    <span class={`tag deal ${props.club ? "club" : ""}`} title={props.title}>
      <Icon d={P.tag} size={13} /> {props.children ?? t(props.club ? "dealClub" : "deal")}
    </span>
  );
}

/** מבצע בשורת סניף: תג + "2 ב-₪24" + התנאים */
export function DealInfo(props: { d: Deal; weighted?: boolean; compact?: boolean }) {
  const app = useApp();
  const { d } = props;
  const terms = dealTerms(d, app.market, props.weighted).filter((x) => !(d.club && x === t("dealClubOnly")));
  return (
    <span class="deal-info" title={d.descr || undefined}>
      <DealTag club={d.club}>{t(d.club ? "dealClub" : "deal")}: {dealPrice(d, app.market, props.weighted)}</DealTag>
      {!props.compact && terms.length > 0 && <small class="muted">{terms.join(" · ")}</small>}
    </span>
  );
}

/** האם לכרטיס המוצר יש מחיר מבצע לכל הלקוחות שנמוך מהמחיר הרגיל הנמוך */
export const cardSale = (p: Pick<Product, "deal_ag" | "min_ag">) => p.deal_ag != null && p.deal_ag > 0 && p.deal_ag < p.min_ag;

/** תג המבצע בכרטיס מוצר: "מבצע · 2 ב-₪24" / "מבצע מועדון ₪9.90" / "מבצע ב-3 סניפים" */
export function CardDeal(props: { p: Product }) {
  const app = useApp();
  const { p } = props;
  if (!p.n_deals) return null;
  if (cardSale(p)) {
    const multi = (p.deal_qty ?? 1) > 1 && p.deal_total_ag;
    return <DealTag>{t("deal")}{multi ? ` · ${dealPrice({ min_qty: p.deal_qty!, total_ag: p.deal_total_ag! }, app.market, p.is_weighted)}` : ""}</DealTag>;
  }
  if (p.club_ag != null && p.club_ag > 0 && p.club_ag < p.min_ag) return <DealTag club>{t("dealClub")} {money(p.club_ag, app.market)}</DealTag>;
  return <DealTag>{t("dealStores", { n: p.n_deals })}</DealTag>;
}

/** מתג "לכלול מבצעי מועדון" */
export function ClubToggle() {
  const [club, setClub] = useClub();
  return (
    <label class="sub-toggle panel club-toggle">
      <span class="grow"><b>{t("clubToggle")}</b><small class="muted">{t("clubHint")}</small></span>
      <input type="checkbox" role="switch" class="switch" checked={club} onChange={() => setClub(!club)} />
    </label>
  );
}

export { dealUnit };
export type { AppliedDeal, Deal, PromoRow };
