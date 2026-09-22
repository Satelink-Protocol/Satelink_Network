import { test, expect } from "@playwright/test";

// Route smoke (§9): every reposition route returns the expected status and the
// shared chrome renders. Checkout routes are noindex.
const OK_ROUTES = [
  "/",
  "/intelligence",
  "/intelligence/funding-rate-heatmap",
  "/intelligence/liquidation-clusters",
  "/corporate",
  "/pricing",
  "/machine",
  "/network",
  "/rpc",
  "/contact",
  "/terms",
  "/privacy",
  "/refund",
  "/checkout?plan=starter",
  "/checkout/cancel",
  "/styleguide",
];

for (const path of OK_ROUTES) {
  test(`GET ${path} → 200`, async ({ page }) => {
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(res, `no response for ${path}`).toBeTruthy();
    expect(res!.status(), `${path} status`).toBeLessThan(400);
  });
}

test("home renders machine-commerce H1 and shared footer legal links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/machines can buy/i);
  // Footer links to Refund & Cancellation appear in both the Legal column and
  // the bottom bar — assert at least one is present.
  await expect(page.getByRole("link", { name: /Refund & Cancellation/ }).first()).toBeVisible();
});

test("checkout routes are noindex", async ({ page }) => {
  await page.goto("/checkout?plan=starter");
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);
});

test("unknown checkout plan redirects to /pricing", async ({ page }) => {
  await page.goto("/checkout?plan=bogus");
  await expect(page).toHaveURL(/\/pricing$/);
});

test("liquidation-clusters page shows the mandatory model limitations", async ({ page }) => {
  await page.goto("/intelligence/liquidation-clusters");
  await expect(page.getByText(/model, not a measurement/i)).toBeVisible();
});
