/** החשבון שלי: הכול במכשיר בלבד */
import { useState } from "preact/hooks";
import { MARKETS, type Lang } from "../../../src/shared/market.ts";
import { getLang, t } from "../i18n.ts";
import { compareHistory, deleteCompare, deleteList, favChains, favProducts, getPrefs, lists, setPrefs, toggleFavChain } from "../local.ts";
import { isMuted, setMuted } from "../sounds.ts";
import { u, ChainLogo, cityLabel, date, Duo, go, Icon, money, P, useApp, type BasketItem } from "../ui.tsx";

declare const __BUILD__: string;
export function AccountPage(props: { onLang: (l: Lang) => void }) {
  const app = useApp();
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const prefs = getPrefs();
  const [muted, setM] = useState(isMuted);

  return (
    <section class="account-page" aria-labelledby="acc-title">
      <h1 id="acc-title">{t("accTitle")}</h1>
      <p class="muted"><Duo name="verified" size={18} /> {t("accLocal")}</p>
      <div class="acc-grid">
        <section class="panel" aria-labelledby="pref-t">
          <div class="panel-head"><Duo name="globe" size={28} /><h2 id="pref-t" class="grow">{t("prefs")}</h2></div>
          <label class="fld"><span>{t("country")}</span>
            <select value={prefs.market} onChange={(e) => { setPrefs({ ...prefs, market: (e.target as HTMLSelectElement).value }); refresh(); }}>
              {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.flag} {m.name[getLang()]}</option>)}
            </select>
          </label>
          <small class="muted">{t("moreCountries")}</small>
          <label class="fld"><span>{t("language")}</span>
            <select value={getLang()} onChange={(e) => props.onLang((e.target as HTMLSelectElement).value as Lang)}>
              <option value="he">עברית</option><option value="en">English</option>
            </select>
          </label>
          <div class="fld"><span>{t("region")}</span>
            <button class="btn ghost" onClick={app.pickCity}><Icon d={P.pin} size={18} /> {cityLabel(app.city)}</button></div>
          <div class="fld"><span>{t("sounds")}</span>
            <button class="btn ghost" aria-pressed={muted} onClick={() => { setMuted(!muted); setM(!muted); }}>
              <Icon d={muted ? P.mute : P.sound} size={18} /> {muted ? t("soundOn") : t("soundOff")}</button></div>
          <p class="muted xs">{t("brand")} · {getLang() === "he" ? "גרסה" : "Version"} {__BUILD__}</p>
          <div class="fld"><span>{t("helpTitle")}</span><a class="btn ghost" href={u("/help")}><Icon d={P.help} size={18} /> {t("helpSub")}</a></div>
          <div class="fld"><span>{t("notifications")}</span><p class="muted small">{t("notifUnavailable")}</p></div>
          {app.index && (
            <div class="fld"><span>{t("dataSource")}</span>
              <p class="muted small">{app.market.source[getLang()]}<br />{t("dataUpdated", { s: app.index.totals.stores, c: app.index.chains.length, t: date(app.index.dataUpdatedAt, app.market, true) })}</p></div>
          )}
          <div class="fld"><span>{t("credits")}</span>
            <p class="muted small">{t("creditPhotos")}<br />{t("creditFont")}</p></div>
        </section>

        <section class="panel" aria-labelledby="lists-t">
          <div class="panel-head"><Duo name="list" size={28} /><h2 id="lists-t" class="grow">{t("lists")}</h2></div>
          {lists().length === 0 ? <p class="muted small">{t("listsEmpty")}</p> : (
            <ul class="plain-list">{lists().map((l) => (
              <li key={l.id}>
                <span class="grow"><b>{l.name}</b> <small class="muted">· {l.items.length} · {date(l.created, app.market)}</small></span>
                <button class="btn small" onClick={() => { app.setBasket(l.items.map((i) => ({ ...(i.data as BasketItem), qty: i.qty }))); go({ name: "cart" }); }}>{t("load")}</button>
                <button class="btn icon ghost" aria-label={`${t("del")}: ${l.name}`} onClick={() => { deleteList(l.id); refresh(); }}><Icon d={P.trash} size={18} /></button>
              </li>
            ))}</ul>
          )}
        </section>

        <section class="panel" aria-labelledby="fav-t">
          <div class="panel-head"><Duo name="heart" size={28} /><h2 id="fav-t" class="grow">{t("favProducts")}</h2></div>
          {favProducts().length === 0 ? <p class="muted small">{t("favEmpty")}</p> : (
            <ul class="plain-list">{favProducts().map((f) => (
              <li key={f.barcode}><a class="grow" href={u(`/product/${encodeURIComponent(f.barcode)}`)}>{f.name}</a></li>
            ))}</ul>
          )}
          <div class="panel-head"><Duo name="store" size={28} /><h2 class="grow">{t("favChains")}</h2></div>
          {favChains().length === 0 ? <p class="muted small">{t("favChainsEmpty")}</p> : (
            <ul class="plain-list">{favChains().map((c) => (
              <li key={c.id}><ChainLogo name={c.name} id={c.id} size="s" /><span class="grow">{c.name}</span>
                <button class="btn icon ghost" aria-label={`${t("unfavorite")}: ${c.name}`} onClick={() => { toggleFavChain(c.id, c.name); refresh(); }}><Icon d={P.heart} size={18} /></button></li>
            ))}</ul>
          )}
        </section>

        <section class="panel" aria-labelledby="hist-t">
          <div class="panel-head"><Duo name="history" size={28} /><h2 id="hist-t" class="grow">{t("histTitle")}</h2></div>
          {compareHistory().length === 0 ? <p class="muted small">{t("recentEmpty")}</p> : (
            <ul class="plain-list">{compareHistory().map((r) => (
              <li key={r.id}>
                <span class="grow">{t("histItem", { n: r.items, store: r.best?.chain ?? "—", p: r.best ? money(r.best.total_ag, app.market) : "" })}<small class="muted"> · {r.city} · {date(r.at, app.market, true)}</small></span>
                <button class="btn icon ghost" aria-label={t("del")} onClick={() => { deleteCompare(r.id); refresh(); }}><Icon d={P.trash} size={18} /></button>
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </section>
  );
}
