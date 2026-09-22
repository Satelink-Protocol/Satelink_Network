import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.AUDIT_BASE || "https://satelink.network";
const OUT = process.env.AUDIT_OUT || "/tmp/site-audit";
const TAG = process.env.AUDIT_TAG || "before";

const ROUTES = [
  "/",
  "/pricing",
  "/intelligence",
  "/intelligence/success?account=sk_test_dummykeyfordisplay1234",
  "/contact",
  "/privacy",
  "/refund",
  "/terms",
  "/login",
  "/docs",
  "/docs/quick-start",
  "/status",
  "/machine",
  "/design",
  "/tasks",
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const results = [];
for (const route of ROUTES) {
  const url = BASE + route;
  const fname = (route === "/" ? "home" : route.replace(/^\//, "").replace(/[/?=&]/g, "_")) + `.${TAG}.png`;
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${fname}`, fullPage: true });
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const h1Color = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      return h1 ? getComputedStyle(h1).color : null;
    });
    results.push({
      route,
      status: resp ? resp.status() : null,
      file: fname,
      bodyBackgroundColor: bodyBg,
      h1Color,
    });
    console.log(`OK  ${route} -> ${fname} (status ${resp ? resp.status() : "?"}, bg ${bodyBg})`);
  } catch (err) {
    results.push({ route, error: String(err) });
    console.log(`ERR ${route} -> ${err}`);
  }
}

fs.writeFileSync(`${OUT}/results.${TAG}.json`, JSON.stringify(results, null, 2));
await browser.close();
