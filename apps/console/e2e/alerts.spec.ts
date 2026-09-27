import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// D7 alerts page (CONSOLE_ACCOUNTS_V1): real /v1/me/alerts via the local harness.
//   ACCOUNTS_E2E=1 PW_BASE_URL=http://localhost:3412 HARNESS_URL=http://127.0.0.1:4455 npx playwright test e2e/alerts.spec.ts
test.skip(!process.env.ACCOUNTS_E2E, "needs the accounts harness");

const HARNESS = process.env.HARNESS_URL || "http://127.0.0.1:4455";

async function signedIn(page: Page, baseURL: string, width = 1280, height = 860) {
  const id = (await (await fetch(`${HARNESS}/__seed/user`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Alert Tester" }) })).json()).id;
  await page.setViewportSize({ width, height });
  await page.context().addCookies([{ name: "satelink.session_token", value: id, url: baseURL }, { name: "slc_mode", value: "advanced", url: baseURL }]);
}

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
}

test("alerts: rules, save preferences, send test alert, history — no placeholder copy", async ({ page, baseURL }) => {
  await signedIn(page, baseURL!);
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
  await expect(page.getByText("Alerts aren't available yet")).toHaveCount(0);

  const rules = page.getByRole("region", { name: "Alert rules" }).or(page.getByLabel("Alert rules"));
  await expect(rules.getByText("Low balance")).toBeVisible();
  await expect(rules.getByText("not measured", { exact: true })).toBeVisible(); // error rate is honest about being unmeasured
  await expect(page.getByText("No alerts sent yet")).toBeVisible();
  await axeClean(page);

  await page.getByLabel(/fall below \(USD\)/).fill("1.5");
  await page.getByRole("button", { name: "Save alerts" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/fall below \(USD\)/)).toHaveValue("1.5");
  await expect(rules.getByText(/Below \$1\.5/)).toBeVisible();

  await page.getByRole("button", { name: "Send test alert" }).click();
  // The harness has no email provider: the attempt is recorded, never faked as sent.
  await expect(page.getByRole("alert").filter({ hasText: "isn't configured yet" })).toBeVisible();
  const history = page.getByLabel("Alert history");
  await expect(history.getByText("Test", { exact: true })).toBeVisible();
  await expect(history.getByText("not sent — email not configured")).toBeVisible();
});

test("alerts: invalid value is refused with a message", async ({ page, baseURL }) => {
  await signedIn(page, baseURL!);
  await page.goto("/alerts");
  await page.getByLabel(/Error-rate threshold/).fill("0");
  await page.getByRole("button", { name: "Save alerts" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "isn't allowed" })).toBeVisible();
});

test("alerts: works at 360 px without horizontal scroll", async ({ page, baseURL }) => {
  await signedIn(page, baseURL!, 360, 780);
  await page.goto("/alerts");
  await expect(page.getByRole("button", { name: "Send test alert" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
