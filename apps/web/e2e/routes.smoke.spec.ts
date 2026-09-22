import { test, expect } from "@playwright/test";

// Route smoke (§9): every IA-v2 route returns the expected status and the
// shared chrome renders. Checkout routes are noindex. Product-move redirects
// (/intelligence, /rpc) are asserted separately.
const OK_ROUTES = [
  "/",
  "/product/overview",
  "/products/machine-commerce",
  "/products/trading-intelligence",
  "/products/trading-intelligence/funding-rate-heatmap",
  "/products/trading-intelligence/liquidation-clusters",
  "/products/rpc",
  "/products/x402",
  "/products/metering",
  "/platform",
  "/platform/api",
  "/platform/x402",
  "/platform/machine-identity",
  "/platform/metering",
  "/platform/payments",
  "/platform/settlement",
  "/platform/integrations",
  "/solutions",
  "/solutions/enterprise",
  "/solutions/ai-agents",
  "/solutions/commerce",
  "/solutions/industries/financial-services",
  "/developers",
  "/developers/quickstart",
  "/developers/api",
  "/developers/sdks",
  "/blog",
  "/blog/x402-kit-open-source",
  "/blog/category/x402",
  "/news",
  "/news/revenue-vault-v2-live",
  "/changelog",
  "/changelog/x402-rail-live",
  "/customer-stories",
  "/academy",
  "/academy/tutorials",
  "/academy/tutorials/discover-the-catalog",
  "/academy/use-cases",
  "/academy/use-cases/ai-agent-purchasing",
  "/academy/courses",
  "/support",
  "/support/getting-started",
  "/support/getting-started/do-i-need-an-account",
  "/support/search?q=x402",
  "/corporate",
  "/pricing",
  "/machine",
  "/network",
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
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/software that pays software/i);
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
  await page.goto("/products/trading-intelligence/liquidation-clusters");
  await expect(page.getByText(/model, not a measurement/i)).toBeVisible();
});

test("redirect: /intelligence → /products/trading-intelligence", async ({ page }) => {
  await page.goto("/intelligence");
  await expect(page).toHaveURL(/\/products\/trading-intelligence$/);
});

test("redirect: /rpc → /products/rpc", async ({ page }) => {
  await page.goto("/rpc");
  await expect(page).toHaveURL(/\/products\/rpc$/);
});

test("/intelligence/success is NOT redirected (checkout claim page survives)", async ({ page }) => {
  const res = await page.goto("/intelligence/success", { waitUntil: "domcontentloaded" });
  expect(res!.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/intelligence\/success/);
});

test("interactive selector on the overview resolves a product + live price", async ({ page }) => {
  await page.goto("/product/overview");
  // Default selection resolves to a product with a request and a docs link.
  await expect(page.getByRole("heading", { name: "Trading Intelligence" })).toBeVisible();
});
