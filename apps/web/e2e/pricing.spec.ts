import { test, expect } from "@playwright/test";

// Pricing gate (§4, web-v3 P3): audience toggle, plan cards with no dead buy
// buttons, the usage calculator, the compare matrix, and the two-rails diagram.

test("audience toggle switches Individuals / Agents & API / Enterprise", async ({ page }) => {
  await page.goto("/pricing");
  // Individuals is default: plan cards visible.
  await expect(page.getByRole("tab", { name: "Individuals" })).toHaveAttribute("aria-selected", "true");
  // Switch to Agents & API → rate card row visible.
  await page.getByRole("tab", { name: "Agents & API" }).click();
  await expect(page.getByRole("cell", { name: "Funding-rate heatmap" })).toBeVisible();
  // Enterprise → "Coming later".
  await page.getByRole("tab", { name: /Enterprise/ }).click();
  await expect(page.getByRole("heading", { name: "Coming later" })).toBeVisible();
});

test("Pro/Max cannot be bought yet — 'notify me', no dead buy button", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("link", { name: /Available soon — notify me/ }).first()).toBeVisible();
  // No enabled "Choose Pro/Max" purchase control while plans are disabled.
  await expect(page.getByRole("button", { name: /Choose Pro|Choose Max/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Choose Pro|Choose Max/ })).toHaveCount(0);
});

test("usage calculator recommends a cheapest option and reacts to input", async ({ page }) => {
  await page.goto("/pricing");
  const result = page.locator("#calc-result");
  await expect(result).toContainText(/Cheapest option:/);
  // A tiny volume should resolve to Free (within the 300/mo free quota).
  await page.getByRole("spinbutton").fill("100");
  await expect(result).toContainText(/Free/);
});

test("compare matrix shows grouped rows across plans", async ({ page }) => {
  await page.goto("/pricing#compare");
  const table = page.locator("#compare table");
  await expect(table.getByText("Included Trading-Intelligence calls / month")).toBeVisible();
  for (const group of ["Usage", "API & limits", "Payments", "Support", "Security"]) {
    await expect(table.getByText(group, { exact: true })).toBeVisible();
  }
});
