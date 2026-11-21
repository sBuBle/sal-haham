/** localStorage עטוף ב-try/catch: במצב פרטי / חסימת אתר הגישה עלולה לזרוק */
export function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* אין אחסון — האפליקציה ממשיכה לעבוד בלי לזכור */
  }
}
