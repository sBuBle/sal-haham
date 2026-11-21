/** עזרה ומקור הנתונים, דף "לא נמצא", ושיתוף/הדפסה של הסל */
import { useMemo, useState } from "preact/hooks";
import { getLang, t } from "../i18n.ts";
import { Illus } from "../illus.tsx";
import { u, shareUrl, ChainLogo, cityLabel, date, Icon, money, P, packLabel, useApp } from "../ui.tsx";
import { useCheapestStore } from "./cart.tsx";

export function HelpPage() {
  const app = useApp();
  const he = getLang() === "he";
  // עדכון אחרון לפי רשת: הקובץ החדש ביותר מבין הסניפים של הרשת בעיר הזו (נתון אמיתי מהקבצים)
  const chains = useMemo(() => {
    const m = new Map<string, { id: string; name: string; updated: string; stale: number; n: number }>();
    for (const s of app.stores ?? []) {
      const c = m.get(s.chain_id) ?? { id: s.chain_id, name: s.chain_name, updated: "", stale: 0, n: 0 };
      c.n++;
      if (s.updated > c.updated) c.updated = s.updated;
      if (s.stale) c.stale++;
      m.set(s.chain_id, c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [app.stores]);
  const faq: [string, string][] = he ? [
    ["למה המחיר בקופה שונה?", "אנחנו מציגים את המחיר והמבצעים מהקבצים של הרשת. מבצע נכנס לסכום רק כשהכמות בסל מתאימה לו (למשל 2 יחידות ל\"2 ב-\"), ומבצעי מועדון רק אם ביקשתם. קופונים, הטבות אישיות ומבצעים שתלויים בקניית מוצרים אחרים לא כלולים, ולפעמים הסניף מעדכן מחיר לפני שהקובץ מתעדכן."],
    ["למה מוצר לא מופיע?", "רק מוצרים שהסניפים בעיר מפרסמים מופיעים. נסו לחפש לפי שם אחר, מותג או ברקוד, או בחרו \"כל הארץ\"."],
    ["למה סניף מסומן \"לא עודכן\"?", "הרשת לא פרסמה קובץ חדש לסניף הזה לאחרונה. המחיר יכול להיות ישן."],
    ["צריך אינטרנט?", "רק בפעם הראשונה בכל עיר. אחר כך האתר עובד גם בלי חיבור, עם הנתונים שנשמרו."],
    ["מה נשמר עליי?", "שום דבר בשרת. הסל, הרשימות והחיפושים האחרונים נשמרים רק במכשיר שלכם."],
  ] : [
    ["Why is the price at the till different?", "We show the price and promotions from the chain's files. A deal counts only when your basket quantity qualifies (e.g. 2 units for a \"2 for\" deal), and club deals only if you turn them on. Coupons, personal offers and deals that depend on buying other products aren't included, and a store sometimes changes a price before its file is updated."],
    ["Why can't I find a product?", "Only products the stores in your city publish appear. Try another name, the brand or the barcode, or pick \"Nationwide\"."],
    ["Why is a store marked \"not updated\"?", "The chain hasn't published a new file for that store recently, so its prices may be old."],
    ["Do I need internet?", "Only the first time for each city. After that the site works offline with the saved data."],
    ["What do you store about me?", "Nothing on a server. Your basket, lists and recent searches stay on your device."],
  ];
  return (
    <section class="help-page" aria-labelledby="help-title">
      <div class="section-head"><div class="grow"><h1 id="help-title">{t("helpTitle")}</h1><small class="muted">{t("helpSub")}</small></div></div>
      <div class="help-grid">
        <div class="help-main">
          <section class="panel" aria-labelledby="h-src">
            <h2 id="h-src">{t("helpSource")}</h2>
            <p class="muted">{app.market.source[getLang()]}</p>
            {app.index && <p class="small">{t("dataUpdated", { s: app.index.totals.stores, c: app.index.chains.length, t: date(app.index.dataUpdatedAt, app.market, true) })}</p>}
          </section>
          <section class="panel" aria-labelledby="h-calc">
            <h2 id="h-calc">{t("helpCalc")}</h2>
            <ol class="how">
              <li><span>1</span> {t("helpCalc1")}</li>
              <li><span>2</span> {t("helpCalc2")}</li>
              <li><span>3</span> {t("helpCalc3")}</li>
              <li><span>4</span> {t("helpCalc4")}</li>
            </ol>
          </section>
          <section aria-labelledby="h-faq">
            <div class="section-head"><h2 id="h-faq">{t("helpFaq")}</h2></div>
            <div class="faq panel">
              {faq.map(([q, a]) => <details key={q}><summary>{q}<Icon d={P.down} size={16} /></summary><p class="muted">{a}</p></details>)}
            </div>
          </section>
        </div>
        <section aria-labelledby="h-fresh">
          <div class="section-head"><div class="grow"><h2 id="h-fresh">{t("helpFresh")}</h2><small class="muted">{cityLabel(app.city)}</small></div></div>
          <ul class="fresh panel">
            {chains.map((c) => (
              <li key={c.id}>
                <ChainLogo name={c.name} id={c.id} size="s" />
                <span class="grow"><b>{c.name}</b><small class="muted">{t("nStores", { n: c.n })}</small></span>
                <span class={`small ${c.stale ? "warn-text" : "muted"}`}>{c.updated ? date(c.updated, app.market, true) : "—"}{c.stale ? ` · ${t("staleN", { n: c.stale })}` : ""}</span>
              </li>
            ))}
            {!chains.length && <li class="muted small">…</li>}
          </ul>
        </section>
      </div>
    </section>
  );
}

export function NotFound() {
  return (
    <section class="empty-state not-found" aria-labelledby="nf-title">
      <Illus name="no-results" size={200} />
      <h1 id="nf-title">{t("nfTitle")}</h1>
      <p class="muted">{t("nfText")}</p>
      <div class="nf-actions">
        <a class="btn" href={u("/")}>{t("toHome")}</a>
        <a class="btn ghost" href={u("/search")}>{t("searchProduct")}</a>
      </div>
    </section>
  );
}

/** טקסט הסל לשיתוף/הדפסה: רק נתונים אמיתיים מהסל ומההשוואה */
function basketText(app: ReturnType<typeof useApp>, c: ReturnType<typeof useCheapestStore>) {
  const lines = app.basket.map((b) => `• ${b.name}${packLabel(b) ? ` (${packLabel(b)})` : ""}${b.qty !== 1 ? ` ×${b.qty}` : ""}`);
  const head = c?.full ? t("shareHead", { store: `${c.full.store.chain_name} ${c.full.store.store_name}`, p: money(c.full.total_ag, app.market), where: cityLabel(app.city) }) : t("shareHeadNone", { where: cityLabel(app.city) });
  return `${head}\n\n${lines.join("\n")}\n\n${location.origin}${location.pathname}`;
}

/** כפתור שיתוף: Web Share במכשירים שתומכים, אחרת תפריט עם וואטסאפ, העתקה והדפסה */
export function ShareBasket(props: { compact?: boolean }) {
  const app = useApp();
  const c = useCheapestStore();
  const [open, setOpen] = useState(false);
  if (!app.basket.length) return null;
  const text = basketText(app, c);
  const share = async () => {
    const nav = navigator as any;
    if (nav.share) { try { await nav.share({ title: t("brand"), text }); return; } catch (e: any) { if (e?.name === "AbortError") return; } }
    setOpen(!open);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); app.say(t("copied")); } catch { app.say(t("copyFail")); } setOpen(false); };
  return (
    <div class="share">
      <button class={`btn ghost ${props.compact ? "small" : ""}`} aria-expanded={open} onClick={share}><Icon d={P.share} size={18} /> {t("share")}</button>
      {open && (
        <div class="share-menu" role="menu">
          <a role="menuitem" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener" onClick={() => setOpen(false)}><Icon d={P.nav} size={18} /> {t("shareWhatsapp")}</a>
          <button role="menuitem" onClick={copy}><Icon d={P.list} size={18} /> {t("copyList")}</button>
          <button role="menuitem" onClick={() => { setOpen(false); print(); }}><Icon d={P.download} size={18} /> {t("printList")}</button>
        </div>
      )}
    </div>
  );
}

/** רשימת קניות להדפסה (מוצגת רק בהדפסה) */
export function PrintList() {
  const app = useApp();
  const c = useCheapestStore();
  if (!app.basket.length) return null;
  return (
    <section class="print-only print-list" aria-hidden="true">
      <h1>{t("brand")} · {t("shoppingList")}</h1>
      <p>{c?.full ? t("shareHead", { store: `${c.full.store.chain_name} ${c.full.store.store_name}`, p: money(c.full.total_ag, app.market), where: cityLabel(app.city) }) : cityLabel(app.city)}</p>
      <ul>{app.basket.map((b) => <li key={b.barcode}><span class="box" />{b.name}{packLabel(b) ? ` · ${packLabel(b)}` : ""}{b.qty !== 1 ? ` ×${b.qty}` : ""}</li>)}</ul>
      <p class="small">{t("promoNote")} {date(app.index?.dataUpdatedAt, app.market, true)}</p>
    </section>
  );
}
