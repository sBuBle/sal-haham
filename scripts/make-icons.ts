/** מייצר אייקוני PNG ל-PWA מה-SVG (192, 512, ו-maskable עם שוליים בטוחים). bun run icons */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const svg = readFileSync("web/public/icons/icon.svg", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
const shot = async (size: number, path: string, maskable = false) => {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable ? `<div style="width:100%;height:100%;background:#0a7d38;display:grid;place-items:center"><div style="width:72%;height:72%">${svg.replace('rx="112"', 'rx="0"')}</div></div>` : svg;
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden">${inner}<style>svg{width:100%;height:100%;display:block}</style></body></html>`);
  await page.screenshot({ path, omitBackground: !maskable });
};
await shot(192, "web/public/icons/icon-192.png");
await shot(512, "web/public/icons/icon-512.png");
await shot(512, "web/public/icons/icon-maskable-512.png", true);
await browser.close();
console.log("icons written");
