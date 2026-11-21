/** בחירת עיר: בכניסה ראשונה — מסך מלא; בהחלפת עיר — חלון מעל הדף (לא מאבדים את המקום).
 *  בלי הקלדה: העיר הנוכחית, ערים אחרונות וערים עם הכי הרבה סניפים. עם הקלדה: רשימת התאמות עם מקלדת. */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { matchCities, normalizeCity } from "../../../src/shared/city.ts";
import { MARKETS, type Market } from "../../../src/shared/market.ts";
import { getLang, t } from "../i18n.ts";
import { ChainLogo, Icon, P, type CityChoice } from "../ui.tsx";
import type { CityEntry, SiteIndex } from "../data.ts";

const K_RECENT_CITIES = "sal.recentCities";
const recentCities = (): CityChoice[] => { try { return JSON.parse(localStorage.getItem(K_RECENT_CITIES) ?? "[]"); } catch { return []; } };
const rememberCity = (c: CityChoice) => {
  const same = (x: CityChoice) => (x.kind === "all" ? c.kind === "all" : c.kind === "city" && x.key === c.key && x.name === c.name);
  try { localStorage.setItem(K_RECENT_CITIES, JSON.stringify([c, ...recentCities().filter((x) => !same(x))].slice(0, 4))); } catch {}
};
const choiceName = (c: CityChoice) => (c.kind === "all" ? t("allCountry") : c.name);

export function CityPicker(props: { index: SiteIndex | null; market: Market; current?: CityChoice | null; onMarket: (id: string) => void; onChoose: (c: CityChoice) => void; onCancel?: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const sheet = !!props.onCancel;
  const input = useRef<HTMLInputElement>(null);
  type Opt = CityEntry & { via?: CityEntry };
  const all = useMemo<Opt[]>(() => {
    const idx = props.index;
    if (!idx) return [];
    const bySlug = new Map([...(idx.areas ?? []), ...idx.cities].map((c) => [c.slug, c]));
    const locs = (idx.localities ?? []).flatMap((l) => {
      const a = bySlug.get(l.a);
      return a ? [{ ...a, key: l.n, name: l.n, via: a }] : [];
    });
    return [...idx.cities, ...locs, ...(idx.areas ?? [])];
  }, [props.index]);
  const popular = useMemo(() => [...(props.index?.cities ?? [])].sort((a, b) => b.stores - a.stores).slice(0, 12), [props.index]);
  const matches = useMemo<Opt[]>(() => (q.trim() ? matchCities(all, q, 8) : []), [q, all]);
  const choose = (c: CityChoice) => { rememberCity(c); props.onChoose(c); };
  const pick = (c: Opt) => choose(c.via
    ? { kind: "city", key: c.via.key, name: `${c.name} · ${c.via.name}`, slug: c.via.slug }
    : { kind: "city", key: c.key, name: c.name, slug: c.slug });
  const noMatch = q.trim().length >= 2 && matches.length === 0;
  const recent = recentCities().filter((c) => !(props.current && choiceName(c) === choiceName(props.current)));
  const cur = props.current;
  const curEntry = cur?.kind === "city" ? all.find((c) => c.key === cur.key && !c.via) : null;

  // Esc סוגר את החלון; פוקוס לשדה
  useEffect(() => {
    if (!sheet) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") props.onCancel!(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [sheet]);

  const body = (
    <section class={`picker ${sheet ? "as-sheet" : ""}`} aria-labelledby="picker-title" role={sheet ? "dialog" : undefined} aria-modal={sheet ? true : undefined}>
      {sheet ? (
        <div class="picker-head">
          <h2 id="picker-title" class="grow">{t("pickTitle")}</h2>
          <button class="btn icon ghost" onClick={props.onCancel} aria-label={t("close")}><Icon d={P.close} /></button>
        </div>
      ) : (
        <div class="picker-hero">
          <h1 id="picker-title">{t("pickTitle")}</h1>
          <p>{t("pickSub")}</p>
          <ul class="trust-row">
            <li><Icon d={P.lock} size={18} /> {t("noSignup")}</li>
            <li><Icon d={P.wifiOff} size={18} /> {t("worksOffline")}</li>
          </ul>
        </div>
      )}
      <div class="picker-body">
        {MARKETS.length > 1 && (
          <label class="fld inline market-row"><span>{t("country")}</span>
            <select value={props.market.id} onChange={(e) => props.onMarket((e.target as HTMLSelectElement).value)}>
              {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.flag} {m.name[getLang()]}</option>)}
            </select>
          </label>
        )}
        <div class="field">
          <span class="search-ic"><Icon d={P.search} /></span>
          <label for="city-input" class="sr-only">{t("cityName")}</label>
          <input
            id="city-input" ref={input} class="input big" type="search" role="combobox" list={undefined}
            aria-expanded={matches.length > 0} aria-controls="city-list" aria-autocomplete="list"
            aria-activedescendant={matches[active] ? `city-${active}` : undefined}
            autocomplete="off" enterKeyHint="go" placeholder={t("cityPh")} value={q} autoFocus={typeof matchMedia !== "undefined" && matchMedia("(min-width: 64rem)").matches}
            onInput={(e) => { setQ((e.target as HTMLInputElement).value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && matches[active]) { e.preventDefault(); pick(matches[active]!); }
            }}
          />
          {q && <button class="btn icon ghost" onClick={() => { setQ(""); input.current?.focus(); }} aria-label={t("clear")}><Icon d={P.close} size={18} /></button>}
        </div>

        {!props.index && <div class="skeleton-list" aria-hidden="true"><i /><i /><i /></div>}

        {q.trim() ? (
          <>
            {matches.length > 0 && <p class="eyebrow">{t("results")}</p>}
            <ul id="city-list" role="listbox" class="city-list" aria-label={t("cities")}>
              {matches.map((c, i) => (
                <li key={c.key + c.slug} role="presentation">
                  <button class="row-btn" id={`city-${i}`} role="option" aria-selected={i === active} tabIndex={-1} onClick={() => pick(c)}>
                    <span class="pin"><Icon d={P.pin} size={18} /></span>
                    <span class="grow"><b><Hl text={c.name} q={q} /></b><small class="muted">
                      {c.via ? t("viaArea", { area: c.via.name, s: c.stores }) : c.cities ? t("areaOf", { n: c.cities.length, s: c.stores, c: c.chains }) : t("storesChains", { s: c.stores, c: c.chains })}
                    </small></span>
                    <Icon d={P.fwd} size={18} />
                  </button>
                </li>
              ))}
            </ul>
            {noMatch && (
              <div class="empty" role="status">
                <p>{t("noCity", { q: normalizeCity(q) || q })}</p>
                <p class="muted small">{t("noCityHint")}</p>
              </div>
            )}
          </>
        ) : props.index && (
          <>
            {cur && (
              <div class="cur-city">
                <Icon d={P.pin} size={18} />
                <b>{t("nowIn", { city: choiceName(cur) })}</b>
                {curEntry && <small class="muted">{t("storesChains", { s: curEntry.stores, c: curEntry.chains })}</small>}
              </div>
            )}
            {recent.length > 0 && (
              <div class="picker-sec">
                <p class="eyebrow">{t("recentCities")}</p>
                <div class="chips">{recent.map((c) => <button key={choiceName(c)} class="chip" onClick={() => choose(c)}>{choiceName(c)}</button>)}</div>
              </div>
            )}
            <div class="picker-sec">
              <p class="eyebrow">{t("popularCities")}</p>
              <ul class="city-grid" role="listbox" aria-label={t("popularCities")}>
                {popular.map((c) => {
                  const on = cur?.kind === "city" && cur.key === c.key;
                  return (
                    <li key={c.key} role="presentation">
                      <button class={`city-card ${on ? "on" : ""}`} role="option" aria-selected={on} onClick={() => pick(c)}>
                        <b>{c.name}</b><small>{t("nStores", { n: c.stores })}</small>
                        {on && <span class="cc-check"><Icon d={P.check} size={16} /></span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
        {!q.trim() && (props.index?.areas?.length ?? 0) > 0 && (
          <div class="picker-sec">
            <p class="eyebrow">{t("areas")}</p>
            <div class="chips">{props.index!.areas!.map((a) => <button key={a.key} class="chip" onClick={() => pick(a)}>{a.name} <small class="muted">{a.stores}</small></button>)}</div>
          </div>
        )}
        {/* מתחת לרשימת הערים: מופיעים יחד איתה, ולא נזרקים למטה כשהיא מחליפה את שורות הטעינה */}
        {props.index && (
          <>
            <button class="btn ghost wide all-btn" onClick={() => choose({ kind: "all" })}>
              <Icon d={P.globe} /> {t("searchAll")}
            </button>
            {!sheet && <p class="trust muted small">{t("moreCountries")}</p>}
          </>
        )}
      </div>
    </section>
  );
  if (!sheet) return body;
  return <div class="picker-overlay" onClick={(e) => e.target === e.currentTarget && props.onCancel!()}>{body}</div>;
}

/** מדגיש את החלק שהוקלד בשם (אם מופיע כמו שהוא) */
function Hl(props: { text: string; q: string }) {
  const q = props.q.trim();
  const i = q ? props.text.indexOf(q) : -1;
  if (i < 0) return <>{props.text}</>;
  return <>{props.text.slice(0, i)}<mark>{props.text.slice(i, i + q.length)}</mark>{props.text.slice(i + q.length)}</>;
}

/** בחירת רשת: "כל הרשתות" ראשון, ואחריו הרשתות בעיר עם לוגו ומספר סניפים */
export function ChainPicker(props: { chains: { id: string; name: string; n: number }[]; current: string | null; where: string; onChoose: (id: string | null) => void; onCancel: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") props.onCancel(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  const total = props.chains.reduce((s, c) => s + c.n, 0);
  const row = (id: string | null, name: string, n: number) => {
    const on = props.current === id;
    return (
      <li key={id ?? "all"} role="presentation">
        <button class={`chain-row ${on ? "on" : ""}`} role="option" aria-selected={on} onClick={() => props.onChoose(id)}>
          {id ? <ChainLogo name={name} id={id} /> : <span class="chain-logo all"><Icon d={P.store} size={20} /></span>}
          <span class="grow"><b>{name}</b><small class="muted">{t("nStores", { n })}</small></span>
          {on && <Icon d={P.check} size={18} />}
        </button>
      </li>
    );
  };
  return (
    <div class="picker-overlay" onClick={(e) => e.target === e.currentTarget && props.onCancel()}>
      <section class="picker as-sheet chain-picker" role="dialog" aria-modal="true" aria-labelledby="chain-title">
        <div class="picker-head">
          <div class="grow"><h2 id="chain-title">{t("chainPickTitle")}</h2><small class="muted">{t("chainPickSub", { where: props.where })}</small></div>
          <button class="btn icon ghost" onClick={props.onCancel} aria-label={t("close")}><Icon d={P.close} /></button>
        </div>
        <ul class="chain-list" role="listbox" aria-label={t("chainLabel")}>
          {row(null, t("allChains"), total)}
          {props.chains.map((c) => row(c.id, c.name, c.n))}
        </ul>
      </section>
    </div>
  );
}
