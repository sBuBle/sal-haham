/**
 * מנועי איסוף. כל מנוע מחזיר רשימת קבצים זמינים (שם + פונקציית הורדה).
 *  - cerberus: url.publishedprices.co.il (ממשק ה-web; קיים גם FTPS ל-url.retail.publishedprices.co.il)
 *  - bina:     {chain}.binaprojects.com
 *  - shufersal: prices.shufersal.co.il (טבלה עם קישורי blob, עם עמודים)
 *  - carrefour: prices.carrefour.co.il (רשימת files בתוך הדף)
 */
import { CookieJar, downloadTo, http } from "./http.ts";

export interface RemoteFile {
  name: string;
  download(path: string): Promise<number>;
}

export interface Engine {
  list(): Promise<RemoteFile[]>;
}

// ---------------- Cerberus ----------------
const CERBERUS = "https://url.publishedprices.co.il";

function csrf(html: string): string {
  const m = html.match(/name="csrftoken"\s+content="([^"]+)"/);
  if (!m) throw new Error("Cerberus: csrftoken לא נמצא");
  return m[1]!;
}

export function cerberus(username: string, password = ""): Engine {
  const jar = new CookieJar();
  return {
    async list() {
      const login = await http(`${CERBERUS}/login`, { jar });
      const t1 = csrf(await login.text());
      const body = new URLSearchParams({ r: "", username, password, Submit: "Sign in", csrftoken: t1 });
      const post = await http(`${CERBERUS}/login/user`, {
        jar, method: "POST", body, redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const loc = post.headers.get("location") ?? "";
      if (post.status !== 302 || !loc.includes("/file")) throw new Error(`Cerberus: התחברות נכשלה עבור ${username} (${post.status})`);
      const page = await http(`${CERBERUS}/file`, { jar });
      const t2 = csrf(await page.text());
      const q = new URLSearchParams({
        sEcho: "1", iColumns: "5", sColumns: ",,,,", iDisplayStart: "0", iDisplayLength: "100000",
        sSearch: "", bRegex: "false", iSortingCols: "0", cd: "/", csrftoken: t2,
      });
      for (let i = 0; i < 5; i++) {
        q.set(`mDataProp_${i}`, String(i)); q.set(`sSearch_${i}`, ""); q.set(`bRegex_${i}`, "false");
        q.set(`bSearchable_${i}`, "true"); q.set(`bSortable_${i}`, "true");
      }
      const dir = await http(`${CERBERUS}/file/json/dir`, {
        jar, method: "POST", body: q,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
      });
      const json: any = await dir.json();
      return (json.aaData ?? [])
        .filter((f: any) => f.type === "file")
        .map((f: any) => ({
          name: String(f.fname),
          download: (path: string) => downloadTo(`${CERBERUS}/file/d/${encodeURIComponent(f.fname)}`, path, { jar }),
        }));
    },
  };
}

// ---------------- Bina ----------------
/** WFileType: 1=Stores 2=Price 3=Promo 4=PriceFull 5=PromoFull. בלי סוג (0) השרת מחזיר רק 1000 קבצים אחרונים,
 *  ואז קובץ ה-Stores (שמתפרסם פעם ביום) נעלם מהרשימה — לכן מבקשים כל סוג בנפרד. */
export function bina(sub: string, types = [1, 4, 2, 5, 3]): Engine {
  const base = `https://${sub}.binaprojects.com`;
  return {
    async list() {
      const arr: any[] = [];
      for (const type of types) {
        const res = await http(`${base}/MainIO_Hok.aspx`, {
          method: "POST",
          body: new URLSearchParams({ WStore: "", WDate: "", WFileType: String(type) }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        arr.push(...((await res.json()) as any[]));
      }
      return arr.map((f) => ({
        name: String(f.FileNm).trim(),
        async download(path: string) {
          const r = await http(`${base}/Download.aspx?FileNm=${encodeURIComponent(String(f.FileNm).trim())}`, {
            method: "POST", headers: { "Content-Length": "0" }, body: "",
          });
          const j: any = await r.json();
          const spath = String(j?.[0]?.SPath ?? "");
          if (!spath) throw new Error("Bina: SPath חסר");
          return downloadTo(spath.replace(/\\/g, "/"), path);
        },
      }));
    },
  };
}

// ---------------- Shufersal ----------------
/** catID: 1=Price 2=PriceFull 3=Promo 4=PromoFull 5=Stores */
export function shufersal(categories = [5, 2, 4], maxPages = 60): Engine {
  const base = "https://prices.shufersal.co.il";
  return {
    async list() {
      const out: RemoteFile[] = [];
      const seen = new Set<string>();
      for (const cat of categories) {
        for (let page = 1; page <= maxPages; page++) {
          const html = await (await http(`${base}/FileObject/UpdateCategory?catID=${cat}&storeId=0&page=${page}`)).text();
          const links = [...html.matchAll(/href="(https:\/\/[^"]+\.(?:gz|xml|zip)[^"]*)"/gi)].map((m) => m[1]!.replace(/&amp;/g, "&"));
          let added = 0;
          for (const url of links) {
            const name = decodeURIComponent(url.split("?")[0]!.split("/").pop()!);
            if (seen.has(name)) continue;
            seen.add(name);
            added++;
            out.push({ name, download: (path) => downloadTo(url, path) });
          }
          if (!added) break;
        }
      }
      return out;
    },
  };
}

// ---------------- חצי חינם ----------------
/** shop.hazi-hinam.co.il/Prices: טבלה עם עמודים. t=3 קובצי סניפים, t=1 מחירים (Price + PriceFull), t=2 מבצעים (Promo + PromoFull). */
export function haziHinam(maxPages = 400): Engine {
  const base = "https://shop.hazi-hinam.co.il/Prices";
  return {
    async list() {
      const out: RemoteFile[] = [];
      const seen = new Set<string>();
      for (const t of [3, 1, 2]) {
        for (let p = 1; p <= maxPages; p++) {
          const html = await (await http(`${base}?p=${p}&t=${t}`)).text();
          const links = [...html.matchAll(/href="(https:\/\/[^"]+\.(?:gz|xml|zip))"/gi)].map((m) => m[1]!);
          if (!links.length) break;
          for (const url of links) {
            const name = decodeURIComponent(url.split("/").pop()!);
            if (seen.has(name)) continue;
            seen.add(name);
            out.push({ name, download: (path) => downloadTo(url, path) });
          }
        }
      }
      return out;
    },
  };
}

// ---------------- סופר-פארם ----------------
/** prices.super-pharm.co.il: טבלת mvc-grid, סינון לפי סוג (Category-equals) ועמודים של 20 */
export function superPharm(maxPages = 200): Engine {
  const base = "https://prices.super-pharm.co.il";
  return {
    async list() {
      const out: RemoteFile[] = [];
      const seen = new Set<string>();
      for (const cat of ["Stores", "PriceFull", "PromoFull", "Price", "Promo"]) {
        for (let p = 1; p <= maxPages; p++) {
          const html = await (await http(`${base}/?Category-equals=${cat}&page=${p}`)).text();
          const links = [...html.matchAll(/href="(\/Download\/[^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
          let added = 0;
          for (const rel of links) {
            const name = decodeURIComponent(rel.split("?")[0]!.split("/").pop()!);
            if (seen.has(name)) continue;
            seen.add(name);
            added++;
            out.push({ name, download: (path) => downloadTo(base + rel, path) });
          }
          if (!added) break;
          // מחירים חלקיים: מספיקים העמודים הראשונים (החדשים)
          if ((cat === "Price" || cat === "Promo") && p >= 10) break;
        }
      }
      return out;
    },
  };
}

// ---------------- Carrefour ----------------
export function carrefour(): Engine {
  const base = "https://prices.carrefour.co.il";
  return {
    async list() {
      const html = await (await http(`${base}/`)).text();
      const path = html.match(/const path\s*=\s*'([^']+)'/)?.[1];
      const files = html.match(/const files\s*=\s*(\[.*?\]);/s)?.[1];
      if (!path || !files) throw new Error("Carrefour: מבנה הדף השתנה");
      return (JSON.parse(files) as { name: string }[]).map((f) => ({
        name: f.name,
        download: (p: string) => downloadTo(`${base}/${path}/${f.name}`, p),
      }));
    },
  };
}
