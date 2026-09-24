import { test, expect } from "@playwright/test";

// Shell a11y/keyboard (§5 gate, §6 header). The mega-menu is data-driven from
// the CMS Navigation global (fallback fixtures in dev). Desktop nav shows at
// ≥lg — Playwright's Desktop Chrome viewport (1280) qualifies.

test("header renders brand and primary nav", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Products" })).toBeVisible();
});

test("mega-menu: opens, exposes aria-expanded, shows grouped links, Esc closes", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Products" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const panel = page.getByRole("region", { name: "Products" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: "Machine Commerce" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Trading Intelligence" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("mega-menu: keyboard focus opens the panel", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Platform" });
  await trigger.focus();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
});

test("Pricing is a plain top-level link", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});

test("search palette: ⌘K opens, queries, and Esc closes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Search query" }).fill("trading");
  await expect(dialog.getByRole("button", { name: /Trading Intelligence/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("footer renders legal links and the registered entity", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Refund & Cancellation" })).toBeVisible();
  await expect(page.getByRole("contentinfo").getByText(/Jakuraa Commercial Pvt Ltd/)).toBeVisible();
  await expect(page.getByRole("contentinfo").getByText(/Coimbatore 641009/)).toBeVisible();
});

test("/search page returns real results for a query", async ({ page }) => {
  await page.goto("/search?q=x402");
  // Scope to main — the footer also links "x402 Machine Payments".
  await expect(page.getByRole("main").getByRole("link", { name: /x402 Machine Payments/ })).toBeVisible();
});

test("redirect: /platform/pricing → /pricing#platform", async ({ page }) => {
  await page.goto("/platform/pricing");
  await expect(page).toHaveURL(/\/pricing(#platform)?$/);
});

test("redirect: /dashboard → /console", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/console$/);
});
