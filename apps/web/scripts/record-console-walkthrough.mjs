#!/usr/bin/env node
// Records the product walkthrough for the home page (src/lib/media.ts).
//
//   CONSOLE_URL=https://<staging-host> DEMO_EMAIL=… DEMO_PASSWORD=… \
//     node apps/web/scripts/record-console-walkthrough.mjs
//
// Flow: sign in (seeded demo account) → create an agent key → run one Trading
// Intelligence query → open Usage → open the receipt. The demo account must
// live on a STAGING database and be named as test data; the script refuses
// production hosts. Output: out/walkthrough/raw.webm, then encode with:
//
//   ffmpeg -i raw.webm -vf "scale=1280:-2,fps=30" -c:v libx264 -preset slow -crf 28 \
//     -profile:v high -pix_fmt yuv420p -movflags +faststart -an walkthrough.mp4
//   ffmpeg -i raw.webm -vf "scale=1280:-2,fps=30" -c:v libvpx-vp9 -b:v 0 -crf 40 -an walkthrough.webm
//   ffmpeg -ss 00:00:06 -i walkthrough.mp4 -frames:v 1 -q:v 3 poster.jpg
//
// Keep each file ≤ 4 MB (raise -crf if not), write captions to walkthrough.vtt
// from the step log this script prints, upload all four to Vercel Blob, then
// fill `productVideo` in src/lib/media.ts with the Blob URLs and the date.
import { chromium } from "playwright";
import fs from "node:fs";

const base = process.env.CONSOLE_URL;
const email = process.env.DEMO_EMAIL;
const password = process.env.DEMO_PASSWORD;
if (!base || !email || !password) {
  console.error("CONSOLE_URL, DEMO_EMAIL and DEMO_PASSWORD are required.");
  process.exit(2);
}
const host = new URL(base).hostname;
if (/(^|\.)satelink\.network$/.test(host) && process.env.ALLOW_PROD_RECORDING !== "i-understand") {
  console.error(`Refusing to record against production host ${host}. Use a staging deployment + staging DB.`);
  process.exit(2);
}

const out = "out/walkthrough";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  recordVideo: { dir: out, size: { width: 1280, height: 800 } },
  colorScheme: "dark",
});
const page = await context.newPage();
const t0 = Date.now();
const log = (step) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${step}`);
const beat = (ms = 1200) => page.waitForTimeout(ms);

log("Sign in");
await page.goto(new URL("/login", base).toString());
await page.getByLabel(/email/i).fill(email);
await page.getByLabel(/password/i).fill(password);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/console|dashboard/);
await beat();

log("Create an agent key");
await page.getByRole("link", { name: /agents|api keys/i }).first().click();
await beat(800);
await page.getByRole("button", { name: /create|new/i }).first().click();
await page.getByLabel(/name/i).fill("walkthrough-demo-agent");
await page.getByRole("button", { name: /create|issue/i }).last().click();
await beat(2000);

log("Run a Trading Intelligence query");
await page.getByRole("link", { name: /trading intel/i }).first().click();
await beat(800);
await page.getByRole("button", { name: /run/i }).first().click();
await beat(2500);

log("Usage");
await page.getByRole("link", { name: /usage/i }).first().click();
await beat(2000);

log("Receipt");
await page.getByRole("link", { name: /billing|receipts/i }).first().click();
await beat(2000);

await context.close();
await browser.close();
const [file] = fs.readdirSync(out).filter((f) => f.endsWith(".webm") && f !== "raw.webm");
if (file) fs.renameSync(`${out}/${file}`, `${out}/raw.webm`);
log(`Saved ${out}/raw.webm — encode with the ffmpeg commands at the top of this file.`);
