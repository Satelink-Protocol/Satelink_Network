import { test, expect } from "@playwright/test";

// Pricing V2 gate: /pricing renders from the PlanCatalog (the same source as
// the API's /v2/plans and the console Billing page — see
// test/plan-catalog-parity.test.ts). No old included-calls model anywhere.

test("plan cards come from the catalog: Free, Launch ($5 → $19), Pro, Max", async ({ page }) => {
  await page.goto("/pricing");
  const cards = page.getByTestId("plan-cards");
  for (const name of ["Free", "Launch", "Pro", "Max"]) await expect(cards.getByRole("heading", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(cards.getByText("$5 for your first month. Renews at $19/month.")).toBeVisible();
  await expect(cards.getByText(/About 750 market-data requests a week/).first()).toBeVisible();
  await expect(page.getByText(/2,500|12,000|300 Trading-Intelligence/)).toHaveCount(0);
});

test("one primary choice per card; nothing is a dead buy button", async ({ page }) => {
  await page.goto("/pricing");
  const cards = page.getByTestId("plan-cards");
  await expect(cards.getByRole("link", { name: "Start free" })).toHaveAttribute("href", /console\.satelink\.network\/sign-in\?mode=signup/);
  // Purchasable items link to the console; anything not yet purchasable says so plainly.
  for (const card of await cards.locator("article").all()) {
    const link = card.getByRole("link");
    const soon = card.getByText("Opening soon");
    expect((await link.count()) + (await soon.count())).toBe(1);
  }
});

test("packs, per-call prices and how payment works", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Credit packs" })).toBeVisible();
  for (const p of ["$10", "$50", "$200"]) await expect(page.getByText(p, { exact: true })).toBeVisible();
  const rates = page.getByRole("region", { name: "Per-call prices" });
  await expect(rates.getByRole("cell", { name: "Polygon RPC" })).toBeVisible();
  await expect(rates.getByRole("cell", { name: "$0.00003" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How payment works" })).toBeVisible();
});

test("anchors used by redirects still resolve (#platform, #agents)", async ({ page }) => {
  await page.goto("/pricing#platform");
  await expect(page.locator("#platform")).toHaveCount(1);
  await expect(page.locator("#agents")).toHaveCount(1);
});

test("FAQ explains UU and the two windows", async ({ page }) => {
  await page.goto("/pricing");
  await page.getByText("What is a UU?").click();
  await expect(page.getByText(/one market-data request is 10 UU/)).toBeVisible();
  await page.getByText("How do the session and weekly allowances work?").click();
  await expect(page.getByText(/resets every Monday in your account's timezone/)).toBeVisible();
});
