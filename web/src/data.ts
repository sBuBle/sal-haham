/** טעינת קובצי הנתונים הסטטיים. ה-Service Worker שומר אותם ב-Cache לשימוש offline. */
import type { StoreInfo } from "../../src/shared/ranking.ts";

export const DATA_BASE: string = (import.meta.env.VITE_DATA_URL as string | undefined) ?? `${import.meta.env.BASE_URL}data/`;

export interface CityEntry { key: string; name: string; slug: string; stores: number; chains: number; cities?: string[] }
export interface SiteIndex {
  version: number;
  generatedAt: string;
  dataUpdatedAt: string | null;
  testData: boolean;
  chains: { id: string; name: string; stores: number }[];
  cities: CityEntry[];
  /** אזורים (נפות) — כל הסניפים בערים הקרובות */
  areas?: CityEntry[];
  /** יישובים בלי סניפים משלהם → slug של האזור */
  localities?: { n: string; a: string }[];
  totals: { stores: number; products: number; prices: number };
}
export interface StoreRow extends StoreInfo { updated: string }

export const dataUrl = (path: string, version?: string) =>
  `${DATA_BASE}${path}${version ? `?v=${encodeURIComponent(version)}` : ""}`;

export async function fetchIndex(): Promise<SiteIndex> {
  const r = await fetch(dataUrl("index.json"), { cache: "no-cache" });
  if (!r.ok) throw new Error(`index.json: ${r.status}`);
  return r.json();
}

export async function fetchStores(scope: { kind: "city"; slug: string } | { kind: "all" }, version: string): Promise<StoreRow[]> {
  const path = scope.kind === "all" ? "all/stores.json" : `cities/${scope.slug}/stores.json`;
  const r = await fetch(dataUrl(path, version));
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}
