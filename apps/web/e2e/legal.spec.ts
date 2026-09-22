import { test, expect } from "@playwright/test";

// Legal suite gate (web-v3 P4 / §5): every policy renders with a plain-English
// summary box, a "Draft pending legal review" banner, a version + date, and an
// H1; the new Billing and Sub-processors pages resolve from the footer.

const POLICIES = [
  "/terms",
  "/privacy",
  "/billing-policy",
  "/refund",
  "/acceptable-use",
  "/data-processing",
  "/cookies",
  "/security",
  "/sub-processors",
  "/responsible-disclosure",
  "/network/operator-terms",
];

for (const path of POLICIES) {
  test(`policy ${path} has summary, draft banner, version, and H1`, async ({ page }) => {
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(res!.status(), `${path} status`).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("[data-legal-summary]")).toBeVisible();
    await expect(page.locator("[data-legal-draft]")).toContainText(/Draft pending legal review/);
    await expect(page.getByText(/Version .* · Last updated/)).toBeVisible();
  });
}

test("footer links to the new Billing and Sub-processors policies resolve", async ({ page }) => {
  await page.goto("/pricing");
  for (const [name, url] of [
    ["Billing & payment", /\/billing-policy$/],
    ["Sub-processors", /\/sub-processors$/],
  ] as const) {
    const link = page.getByRole("link", { name }).first();
    await expect(link).toHaveAttribute("href", url);
  }
});
