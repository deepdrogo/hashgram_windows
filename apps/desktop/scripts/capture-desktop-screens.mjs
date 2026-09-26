// Capture Hashgram One desktop UI screenshots from the Vite + shim server.
// Usage: node scripts/capture-desktop-screens.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// apps/desktop/scripts → repo root is three levels up from this file's dir.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outDir = join(root, "assets", "desktop");
const base = (process.argv[2] || "http://localhost:1420").replace(/\/$/, "");

const shots = [
  ["pulse", "pulse.png"],
  ["reels", "reels.png"],
  ["local", "local.png"],
  ["chats", "chats.png"],
  ["mail", "mail.png"],
  ["drive", "drive.png"],
  ["spaces", "spaces.png"],
  ["contacts", "contacts.png"],
  ["wallet", "wallet.png"],
  ["earn", "earn.png"],
  ["network", "network.png"],
  ["profile/me", "profile.png"],
  ["settings", "settings.png"],
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

await page.goto(`${base}/#/pulse`, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForSelector('nav[aria-label="Main"]', { timeout: 60_000 });
await page.waitForTimeout(800);

for (const [route, file] of shots) {
  await page.goto(`${base}/#/${route}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(900);
  const path = join(outDir, file);
  await page.screenshot({ path, type: "png" });
  console.log("wrote", file);
}

// Hero image used at the top of the README: Pulse is home.
await writeFile(join(outDir, ".captured"), new Date().toISOString());
await browser.close();
console.log("done", outDir);
