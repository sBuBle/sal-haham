/** נתוני משתמש שנשמרים במכשיר בלבד (אין שרת): העדפות, מועדפים, רשימות, היסטוריית השוואות. */
import { load, save } from "./storage.ts";
import type { Lang } from "../../src/shared/market.ts";

export interface Prefs { market: string; lang: Lang | null }
export interface SavedList { id: string; name: string; created: string; items: { barcode: string; name: string; qty: number; data: unknown }[] }
export interface CompareRecord { id: string; at: string; city: string; items: number; best: { chain: string; store: string; total_ag: number } | null; barcodes: string[] }

const K = { prefs: "sal.prefs", favP: "sal.fav.products", favC: "sal.fav.chains", lists: "sal.lists", hist: "sal.history" };

export const getPrefs = (): Prefs => load<Prefs>(K.prefs, { market: "il", lang: null });
export const setPrefs = (p: Prefs) => save(K.prefs, p);

export const favProducts = () => load<{ barcode: string; name: string }[]>(K.favP, []);
export function toggleFavProduct(barcode: string, name: string): boolean {
  const l = favProducts();
  const i = l.findIndex((x) => x.barcode === barcode);
  if (i >= 0) l.splice(i, 1); else l.unshift({ barcode, name });
  save(K.favP, l);
  return i < 0;
}
export const favChains = () => load<{ id: string; name: string }[]>(K.favC, []);
export function toggleFavChain(id: string, name: string): boolean {
  const l = favChains();
  const i = l.findIndex((x) => x.id === id);
  if (i >= 0) l.splice(i, 1); else l.push({ id, name });
  save(K.favC, l);
  return i < 0;
}

export const lists = () => load<SavedList[]>(K.lists, []);
export function saveList(name: string, items: SavedList["items"]) {
  const l = lists();
  l.unshift({ id: String(Date.now()), name, created: new Date().toISOString(), items });
  save(K.lists, l.slice(0, 30));
}
export const deleteList = (id: string) => save(K.lists, lists().filter((x) => x.id !== id));

export const compareHistory = () => load<CompareRecord[]>(K.hist, []);
export function recordCompare(r: Omit<CompareRecord, "id" | "at">) {
  const l = compareHistory();
  const sig = r.barcodes.slice().sort().join(",");
  const rest = l.filter((x) => x.barcodes.slice().sort().join(",") !== sig || x.city !== r.city);
  rest.unshift({ ...r, id: String(Date.now()), at: new Date().toISOString() });
  save(K.hist, rest.slice(0, 20));
}
export const deleteCompare = (id: string) => save(K.hist, compareHistory().filter((x) => x.id !== id));
