// Rasterize assets/logo.svg into the PNG icon set the PWA + Android
// build need. Uses the Playwright Chromium that's already installed for
// screenshots (no extra native rasterizer dependency).
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const svg = readFileSync(resolve(root, "assets/logo.svg"), "utf8");

const targets = [
  { file: "public/logo-512.png", size: 512 },
  { file: "public/logo-192.png", size: 192 },
  { file: "public/favicon-64.png", size: 64 },
  { file: "public/favicon-32.png", size: 32 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const html = `<!doctype html><html><head><style>
    *{margin:0;padding:0}html,body{width:${t.size}px;height:${t.size}px;overflow:hidden}
    svg{width:${t.size}px;height:${t.size}px;display:block}
  </style></head><body>${svg}</body></html>`;
  await page.setContent(html, { waitUntil: "networkidle" });
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
  writeFileSync(resolve(root, t.file), buf);
  console.log(`wrote ${t.file} (${t.size}x${t.size})`);
}
await browser.close();
