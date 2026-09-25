import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Console V2 gate — task completion for all four Simple-mode flows, driven ONLY
// by what a person sees: roles + visible labels + visible text. No test ids, no
// CSS selectors (the "layman usability" proof). Runs against the production
// console build + the local harness API (real /v1/me, /v2/plans,
// /v1/intelligence with seeded TEST FIXTURE snapshots, Dodo TEST mode):
//   ACCOUNTS_E2E=1 PW_BASE_URL=http://localhost:3413 npx playwright test e2e/simple-flows.spec.ts
test.skip(!process.env.ACCOUNTS_E2E, "needs the accounts harness");
test.describe.configure({ mode: "serial" });

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 860 },
  { name: "phone-360", width: 360, height: 780 },
];

async function signedIn(page: Page, baseURL: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.context().addCookies([
    { name: "satelink.session_token", value: "acct_demo", url: baseURL },
    { name: "slc_mode", value: "simple", url: baseURL },
  ]);
}

async function axeClean(page: Page, where: string) {
  // Cast: @axe-core/playwright resolves a second playwright-core copy in this monorepo.
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id} ${v.nodes[0]?.target}`), `axe: ${where}`).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test("1 · Give my software access", async ({ page, baseURL }) => {
      await signedIn(page, baseURL!, vp.width, vp.height);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "What do you want to do?" })).toBeVisible();
      await axeClean(page, "home");
      await noHorizontalScroll(page);
      await page.getByRole("main").getByRole("link", { name: /Give my software access/ }).click();
      await page.getByLabel("Name").fill(`pricing-bot-${vp.name}`);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "What can it use?" })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /Market data/ })).toBeChecked();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByLabel("Monthly limit in US dollars").fill("5");
      await axeClean(page, "agent flow step 3");
      await page.getByRole("button", { name: "Create access" }).click();
      await expect(page.getByRole("heading", { name: "Here is its key" })).toBeVisible();
      await expect(page.getByText(/^sk_free_[0-9a-f]{48}$/)).toBeVisible();
      await page.getByRole("button", { name: "Test it" }).click();
      await expect(page.getByText("It works — Satelink recognises this key. Nothing was charged.")).toBeVisible();
      await page.getByRole("button", { name: "I've saved the key" }).click();
      await expect(page.getByRole("heading", { name: `pricing-bot-${vp.name} can now use Satelink` })).toBeVisible();
      await expect(page.getByText(/up to \$5 a month/)).toBeVisible();
    });

    test("2 · Get market data", async ({ page, baseURL }) => {
      await signedIn(page, baseURL!, vp.width, vp.height);
      await page.goto("/");
      await page.getByRole("main").getByRole("link", { name: /Get market data/ }).click();
      await page.getByRole("radio", { name: /Funding rates across exchanges/ }).check();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByLabel("Search markets").fill("BTC");
      await page.getByRole("radio", { name: "BTCUSDT" }).check();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("$0.01 per request")).toBeVisible();
      // Which bucket pays depends on how much of the allowance earlier runs used.
      await expect(page.getByText(/^(Your plan allowance — no extra charge|Your credit pack|Your crypto credits, if auto-use is on)$/)).toBeVisible();
      await axeClean(page, "data flow price step");
      await page.getByRole("button", { name: "Run for $0.01" }).click();
      await expect(page.getByText("Across 3 exchanges, annualised funding for BTCUSDT ranges from -2.19% (okx) to 10.95% (binance).")).toBeVisible();
      await expect(page.getByText(/Market data, not advice/)).toBeVisible();
      await expect(page.getByText("BTCUSDT funding by exchange (annualised)")).toBeVisible();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV" }).click();
      expect((await download).suggestedFilename()).toBe("funding-rate-heatmap-BTCUSDT.csv");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
      await axeClean(page, "data flow result");
      await noHorizontalScroll(page);
      await page.getByRole("button", { name: "Done" }).click();
      await expect(page.getByRole("heading", { name: "What do you want to look at?" })).toBeVisible();
    });

    test("3 · Add money (credit pack → real Dodo TEST checkout)", async ({ page, baseURL }) => {
      await signedIn(page, baseURL!, vp.width, vp.height);
      await page.goto("/");
      await page.getByRole("main").getByRole("link", { name: /Add money/ }).click();
      await page.getByRole("radio", { name: /A credit pack/ }).check();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("radio", { name: /^\$10/ }).check();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Credit pack $10")).toBeVisible();
      await axeClean(page, "add money review");
      await page.getByRole("button", { name: "Continue to payment" }).click();
      await page.waitForURL(/test\.checkout\.dodopayments\.com/, { timeout: 30_000 });
      // Coming back from Dodo lands on the confirmation screen.
      await page.goto("/billing/add?checkout=done");
      await expect(page.getByRole("heading", { name: "Thanks — payment received" })).toBeVisible();
      await expect(page.getByRole("link", { name: "See billing" })).toBeVisible();
    });

    test("4 · See what I've spent", async ({ page, baseURL }) => {
      await signedIn(page, baseURL!, vp.width, vp.height);
      await page.goto("/");
      await page.getByRole("main").getByRole("link", { name: /See what I've spent/ }).click();
      await expect(page.getByRole("heading", { name: "What you've spent" })).toBeVisible();
      await expect(page.getByText(/^Spent this month/).first()).toBeVisible();
      await expect(page.getByText("Credits left")).toBeVisible();
      await expect(page.getByRole("meter", { name: "This week" })).toBeVisible();
      await axeClean(page, "spend");
      await noHorizontalScroll(page);
    });

    test("Billing renders Pricing V2 from the PlanCatalog (no old plan table)", async ({ page, baseURL }) => {
      await signedIn(page, baseURL!, vp.width, vp.height);
      await page.goto("/billing");
      await expect(page.getByText("$5 for your first month. Renews at $19/month.")).toBeVisible();
      await expect(page.getByText(/UU \/ week/).first()).toBeVisible();
      await expect(page.getByText("Included calls / month")).toHaveCount(0);
      await expect(page.getByText(/12,000/)).toHaveCount(0);
      await axeClean(page, "billing");
    });

    if (vp.width <= 400) {
      test("mobile: bottom tab bar, one-handed navigation", async ({ page, baseURL }) => {
        await signedIn(page, baseURL!, vp.width, vp.height);
        await page.goto("/");
        const tabs = page.getByRole("navigation", { name: "Tabs" });
        for (const t of ["Home", "Data", "Agents", "Billing"]) await expect(tabs.getByRole("link", { name: t })).toBeVisible();
        await tabs.getByRole("link", { name: "Billing" }).click();
        await expect(page).toHaveURL(/\/billing$/);
        const box = await tabs.boundingBox();
        expect(box!.y + box!.height).toBeGreaterThanOrEqual(vp.height - 1);
      });
    }
  });
}

test("Advanced mode: dashboard panels render from real endpoints; mode is remembered", async ({ page, baseURL }) => {
  await signedIn(page, baseURL!, 1440, 900);
  await page.goto("/");
  await page.getByRole("radio", { name: "advanced" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  for (const p of ["Balance", "Spend", "Requests", "Error rate", "Plan usage", "Request log", "Funding heatmap"]) {
    await expect(page.getByRole("region", { name: p, exact: true })).toBeVisible();
  }
  // Market panels never auto-run: explicit, priced click.
  const funding = page.getByRole("region", { name: "Funding heatmap", exact: true });
  await funding.getByRole("button", { name: "Run ($0.01)" }).click();
  await expect(funding.getByText(/Annualised funding by symbol × exchange/)).toBeVisible();
  await axeClean(page, "advanced dashboard");
  await page.screenshot({ path: test.info().outputPath("advanced-1440.png"), fullPage: true });
  // Remembered per account: a fresh browser (no mode cookie) opens in Advanced.
  const fresh = await page.context().browser()!.newContext();
  await fresh.addCookies([{ name: "satelink.session_token", value: "acct_demo", url: baseURL! }]);
  const p2 = await fresh.newPage();
  await p2.goto(`${baseURL}/`);
  await expect(p2.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await p2.getByRole("radio", { name: "simple" }).click();
  await expect(p2.getByRole("heading", { name: "What do you want to do?" })).toBeVisible();
  await fresh.close();
});

test("performance budget: console home ships < 160 kB of JS and paints its main content in < 2.5 s", async ({ page, baseURL }) => {
  await signedIn(page, baseURL!, 1280, 860);
  // Encoded (on-the-wire) size of scripts requested before the load event —
  // later requests are Next's route prefetches, not the cost of this page.
  const scripts: Promise<number>[] = [];
  let loaded = false;
  page.on("requestfinished", (req) => {
    if (!loaded && req.resourceType() === "script") scripts.push(req.sizes().then((sz) => sz.responseBodySize));
  });
  await page.goto("/", { waitUntil: "load" });
  loaded = true;
  const jsBytes = (await Promise.all(scripts)).reduce((a, b) => a + b, 0);
  const lcp = await page.evaluate(() => new Promise<number>((resolve) => {
    new PerformanceObserver((l) => { const e = l.getEntries(); resolve(e[e.length - 1].startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
    setTimeout(() => resolve(-1), 3000);
  }));
  test.info().annotations.push({ type: "budget", description: `JS ${Math.round(jsBytes / 1024)} kB · LCP ${Math.round(lcp)} ms` });
  expect(jsBytes / 1024).toBeLessThan(160);
  expect(lcp).toBeGreaterThan(0);
  expect(lcp).toBeLessThan(2500);
});
