import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";

// Stage 25 — agent-first console, paper E2E. Drives only what a person sees (roles + visible text).
// Needs the local harness (real Stage 24 router + in-memory OMS + MockBroker, paper only) and a
// console production build started with the flag on:
//   (apps/api)     PORT=3419 node test/harness/trading_console_harness.mjs
//   (apps/console) CONSOLE_AGENT_IA=true SATELINK_API_BASE=http://127.0.0.1:3419 npx next start -p 3418
//   TRADING_E2E=1 PW_BASE_URL=http://localhost:3418 npx playwright test e2e/trading-paper.spec.ts
test.skip(!process.env.TRADING_E2E, "needs the trading console harness");
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../../../docs/trading-agent/stages/25-console");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

async function signIn(page: Page, baseURL: string, width = 1280, height = 860) {
  await page.setViewportSize({ width, height });
  await page.context().addCookies([{ name: "satelink.session_token", value: "e2e-alice", url: baseURL }]);
}
async function axeClean(page: Page, where: string) {
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id} ${v.nodes[0]?.target}`), `axe: ${where}`).toEqual([]);
}

test("Home: agent-first navigation, paper label, plain disclosure", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/");
  await expect(page).toHaveURL(/\/trading$/);
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText("Paper — simulated, no real money").first()).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Console" });
  for (const label of ["Home", "Agent", "Markets", "Strategies", "Risk", "Brokers", "Positions", "Orders", "Executions", "P&L", "Activity", "Billing", "Security", "Settings", "RPC", "x402"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Revenue" })).toHaveCount(0);
  await expect(page.getByRole("note")).toContainText("Not investment advice");
  await axeClean(page, "home");
  await shot(page, "01-home");
});

test("Orders: place a paper order and watch it move in plain language, then cancel it", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/trading/orders");
  await page.getByLabel("Broker account").fill("bka_e2e_1");
  await page.getByLabel("Signed permission (mandate)").fill("mdt_e2e_1");
  await page.getByLabel("Broker", { exact: true }).selectOption("mock");
  await page.getByLabel("Instrument").fill("BTC-USDT");
  await page.getByLabel("Quantity").fill("0.001");
  await page.getByLabel("Limit price").fill("30000");
  await shot(page, "02-orders-form");
  await page.getByRole("button", { name: "Place paper order" }).click();
  await expect(page.getByText("This field is required").or(page.getByRole("heading", { name: /Buy 0\.001 BTC-USDT/ }))).toHaveCount(0); // checkbox not ticked → browser blocks submit
  await page.getByLabel(/I understand this is a paper order/).check();
  await page.getByRole("button", { name: "Place paper order" }).click();
  await expect(page.getByRole("heading", { name: "Buy 0.001 BTC-USDT" })).toBeVisible();
  await expect(page.getByText("Order received.")).toBeVisible();
  await expect(page.getByText("Paper — simulated, no real money").first()).toBeVisible();
  // the dispatcher sends it to the simulator; reload until the venue has it
  await expect(async () => { await page.reload(); await expect(page.getByText("The simulator has your order — waiting for a fill")).toBeVisible(); }).toPass({ timeout: 10_000 });
  await expect(page.getByText(/^Complete — every step/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Orders", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Home", exact: true })).not.toHaveAttribute("aria-current", "page");
  await axeClean(page, "order");
  await shot(page, "03-order-acknowledged");
  await page.getByRole("button", { name: "Cancel this order" }).click();
  await expect(page.getByText("Cancel requested.")).toBeVisible();
  await expect(async () => { await page.reload(); await expect(page.getByText("Cancelled", { exact: true })).toBeVisible(); }).toPass({ timeout: 10_000 });
  await shot(page, "04-order-cancelled");
});

test("Risk: pause all trading, then resume only with a 6-digit code", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/trading/risk");
  await expect(page.getByText("Max open positions")).toBeVisible();
  await page.getByRole("button", { name: "Pause all trading" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Trading is paused" })).toBeVisible();
  await page.getByLabel("Why are you resuming?").fill("done testing");
  await page.getByLabel("6-digit code from your authenticator app").fill("000000");
  await page.getByRole("button", { name: "Resume trading" }).click();
  await expect(page.getByText("That code didn't work.")).toBeVisible();
  await shot(page, "05-risk-paused");
  await page.getByLabel("Why are you resuming?").fill("done testing");
  await page.getByLabel("6-digit code from your authenticator app").fill("123456");
  await page.getByRole("button", { name: "Resume trading" }).click();
  await expect(page.getByText("Trading is running again.")).toBeVisible();
  await axeClean(page, "risk");
});

test("Honest empty states, admin-only Revenue, and the phone layout", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/trading/agent");
  await expect(page.getByText("Place, change or cancel an order")).toBeVisible();
  await expect(page.getByText("Not available yet")).toBeVisible();
  await shot(page, "06-agent");
  await page.goto("/trading/brokers");
  await expect(page.getByText("Not available yet").first()).toBeVisible();
  await shot(page, "07-brokers");
  const revenue = await page.goto("/trading/revenue");
  expect(revenue?.status()).toBe(404);
  await page.goto("/rpc"); // the live RPC page is kept
  await expect(page.getByRole("heading", { name: "RPC" })).toBeVisible();
  await signIn(page, baseURL!, 360, 780);
  await page.goto("/trading");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await shot(page, "08-home-phone");
});
