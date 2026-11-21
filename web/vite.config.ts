import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  // כתובות נקיות (/product/123) צריכות נתיב מוחלט. באירוח בתת-תיקייה: BASE_PATH=/שם-התיקייה/
  base: process.env.BASE_PATH ?? "/",
  plugins: [preact(), {
    // כתובת ציבורית (VITE_PUBLIC_URL): קישור קנוני ותגיות שיתוף עם כתובות מלאות. בלי כתובת — לא מוסיפים כתובת שגויה
    name: "public-url",
    transformIndexHtml(html) {
      const site = (process.env.VITE_PUBLIC_URL ?? "").replace(/\/?$/, "/");
      if (site === "/") return html;
      return html
        .replace(/content="[^"]*og\.jpg"/, `content="${site}og.jpg"`)
        .replace("</head>", `    <link rel="canonical" href="${site}" />
    <meta property="og:url" content="${site}" />
  </head>`);
    },
  }, {
    // אירוח סטטי: כתובת עמוקה (/product/123) שאין לה קובץ נפתחת דרך 404.html — עותק של האפליקציה (GitHub Pages ודומים)
    name: "spa-fallback",
    apply: "build",
    closeBundle() {
      const out = join(root, "dist");
      for (const dir of [out, join(root, "dist-e2e")]) if (existsSync(join(dir, "index.html"))) copyFileSync(join(dir, "index.html"), join(dir, "404.html"));
    },
  }],
  // preview: הדפדפן תמיד בודק אם יש גרסה חדשה (קבצי assets עם hash ממילא משתנים בשם)
  preview: { headers: { "Cache-Control": "no-cache" } },
  define: { __BUILD__: JSON.stringify(new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(",", "")) },
  server: { fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
});
