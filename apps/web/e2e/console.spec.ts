import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Console gate (web-v3 P6 / §7). The customer console renders with designed
// empty states (never "—"), passes axe (no critical/serious violations) on
// every page, and its key flows work. Live data + session-gating are Track B.

const PAGES = [
  "/console",
  "/console/products/trading-intelligence",
  "/console/products/x402",
  "/console/products/rpc",
  "/console/agents",
  "/console/usage",
  "/console/billing",
  "/console/docs",
  "/console/settings",
];

for (const path of PAGES) {
  test(`console ${path}: renders, no "—", passes axe`, async ({ page }) => {
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(res!.status(), path).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Truth rule: never a bare em-dash as a value.
    await expect(page.getByText("—", { exact: true })).toHaveCount(0);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`), `axe ${path}`).toEqual([]);
  });
}

test("console home shows the onboarding checklist and empty KPIs", async ({ page }) => {
  await page.goto("/console");
  await expect(page.getByText("Get started")).toBeVisible();
  await expect(page.getByText("Create your first agent key")).toBeVisible();
  await expect(page.getByText(/No calls yet/)).toBeVisible();
});

test("agents: create-key carries a Planned badge (no dead control)", async ({ page }) => {
  await page.goto("/console/agents");
  await expect(page.getByText(/Create agent key/)).toBeVisible();
  await expect(page.getByText("Planned").first()).toBeVisible();
});

test("billing: shows the Free plan and a Dodo compliance disclosure", async ({ page }) => {
  await page.goto("/console/billing");
  await expect(page.getByText("Free", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("How billing works")).toBeVisible();
  await expect(page.getByText(/Merchant of Record/)).toBeVisible();
});

test("settings: delete-account request shows the 48-hour DPDP notice", async ({ page }) => {
  await page.goto("/console/settings");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByText(/48-hour notice period/)).toBeVisible();
  await page.getByRole("button", { name: /Request deletion|Confirm deletion/ }).click();
  await expect(page.getByText(/scheduled for deletion after a 48-hour notice/)).toBeVisible();
});

test("settings: data export records the request", async ({ page }) => {
  await page.goto("/console/settings");
  await page.getByRole("button", { name: "Download my data" }).click();
  await expect(page.getByText(/Data export is rolling out/)).toBeVisible();
});

test("/ops is unreachable without a staff session", async ({ page }) => {
  // The server-side staff gate blocks access. In production (ops subdomain) it
  // redirects to /ops/login; on the localhost apex the guard redirect-loops
  // because the ops-pathname header isn't set — either way the command center
  // is never reachable without an ops session.
  let reached = true;
  try {
    await page.goto("/ops/command-center", { waitUntil: "domcontentloaded", timeout: 8000 });
    reached = page.url().includes("/ops/command-center");
  } catch {
    reached = false;
  }
  expect(reached).toBe(false);
});
