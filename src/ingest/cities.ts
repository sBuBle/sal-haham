/** טעינת מיפוי קודי יישוב של הלמ"ס (נוצר ע"י `bun run cities`) */
import { existsSync, readFileSync } from "node:fs";
import type { CityCodeMap } from "../shared/city.ts";

export const CITY_REF_PATH = "data/ref/cities.json";

export function loadCityCodes(path = CITY_REF_PATH): CityCodeMap {
  const m: CityCodeMap = new Map();
  if (!existsSync(path)) return m;
  const obj = JSON.parse(readFileSync(path, "utf8")) as { codes: Record<string, string> };
  for (const [k, v] of Object.entries(obj.codes ?? {})) m.set(String(parseInt(k, 10)), v);
  return m;
}
