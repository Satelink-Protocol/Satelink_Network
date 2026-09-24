import { test, expect } from "@playwright/test";

// Phase 6 gate (§6): /styleguide renders every CMS block, and the signature
// Lifecycle stepper is keyboard-accessible and SSR-complete.
const BLOCK_TYPES = [
  "hero", "richText", "valueCards", "code", "apiExample", "faq", "cta",
  "callout", "pricingLive", "lifecycleStepper", "machineReadablePanel",
  "comparisonTable", "relatedContent",
];

test("styleguide renders every CMS block type", async ({ page }) => {
  await page.goto("/styleguide");
  for (const t of BLOCK_TYPES) {
    await expect(page.locator(`[data-block="${t}"]`), `block ${t}`).toHaveCount(1);
  }
});

test("lifecycle stepper: tablist, keyboard nav, SSR-complete content", async ({ page }) => {
  await page.goto("/styleguide");
  const tablist = page.getByRole("tablist", { name: "How a machine pays" });
  await expect(tablist).toBeVisible();

  // All 9 panels exist in the DOM (SSR-complete) even though only one shows.
  const panels = page.locator('[id^="lifecycle-panel-"]');
  await expect(panels).toHaveCount(9);

  const first = page.getByRole("tab", { name: /DISCOVER/ });
  await first.focus();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /IDENTIFY/ })).toHaveAttribute("aria-selected", "true");
});
