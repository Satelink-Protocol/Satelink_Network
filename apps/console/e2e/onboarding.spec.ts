import { test, expect, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Onboarding gate (CONSOLE_ONBOARDING_V1) — driven ONLY by what a person sees:
// roles, visible labels and text. Runs against the production console build +
// the local harness (real /v1/me onboarding + consents, real PlanCatalog, real
// Dodo TEST checkout, real signature-verified V2 webhook handler):
//   ONBOARDING_E2E=1 PW_BASE_URL=http://localhost:3413 HARNESS_URL=http://127.0.0.1:4455 npx playwright test e2e/onboarding.spec.ts
test.skip(!process.env.ONBOARDING_E2E, "needs the onboarding harness");
test.describe.configure({ mode: "serial" });

const HARNESS = process.env.HARNESS_URL || "http://127.0.0.1:4455";
const CLIENT_IP = "198.51.100.7"; // what Vercel would put in x-forwarded-for
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 860 },
  { name: "phone-360", width: 360, height: 780 },
];

async function seedUser(name: string) {
  const r = await fetch(`${HARNESS}/__seed/user`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  return (await r.json()).id as string;
}
async function harness<T>(path: string): Promise<T> {
  return (await fetch(`${HARNESS}${path}`)).json() as Promise<T>;
}
async function open(browser: Browser, baseURL: string, account: string, vp: { width: number; height: number }, headers: Record<string, string> = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, extraHTTPHeaders: { "x-forwarded-for": CLIENT_IP, ...headers } });
  await ctx.addCookies([{ name: "satelink.session_token", value: account, url: baseURL }, { name: "slc_mode", value: "simple", url: baseURL }]);
  return ctx.newPage();
}
async function axeClean(page: Page, where: string) {
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id} ${v.nodes[0]?.target}`), `axe: ${where}`).toEqual([]);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
}
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { level: 1, name });
const planCard = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) });

async function createAccount(page: Page, { updates = false } = {}) {
  await expect(heading(page, "Create your account")).toBeVisible();
  const create = page.getByRole("button", { name: "Create account" });
  await expect(create).toBeDisabled();
  await page.getByLabel(/I agree to the Terms of Service/).check();
  await page.getByLabel("I'm 18 or older.").check();
  await page.getByLabel(/I consent to Satelink processing my personal data/).check();
  const optional = page.getByLabel(/Email me product updates/);
  await expect(optional).not.toBeChecked(); // optional consent is never pre-ticked
  if (updates) await optional.check();
  await create.click();
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test("Free: consents stored → name from sign-in → use case → Continue with Free → safety → home with the chosen task", async ({ browser, baseURL }) => {
      const acct = await seedUser("Priya Sharma");
      const page = await open(browser, baseURL!, acct, vp);
      await page.goto("/");
      await expect(page).toHaveURL(/\/welcome$/);
      await axeClean(page, "account");
      await fits(page);
      await createAccount(page);

      await expect(heading(page, "What should we call you?")).toBeVisible();
      await expect(page.getByLabel("Your name")).toHaveValue("Priya Sharma");
      await axeClean(page, "name");
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(heading(page, "What will you use Satelink for?")).toBeVisible();
      await page.getByLabel("What will you use Satelink for?").selectOption({ label: "Market research and dashboards" });
      await expect(page.getByRole("radio", { name: /I'll explore myself/ })).toBeVisible();
      await page.getByRole("radio", { name: /Get market data/ }).check();
      await axeClean(page, "use");
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(heading(page, "Choose your plan")).toBeVisible();
      await expect(planCard(page, "Free").getByText("Recommended for you")).toBeVisible();
      await page.getByRole("button", { name: /^Yearly/ }).click();
      await expect(planCard(page, "Pro").getByText("$190", { exact: true })).toBeVisible();
      await expect(planCard(page, "Pro").getByText("Save $38 a year vs monthly")).toBeVisible();
      await expect(planCard(page, "Pro").getByText("Renews yearly at $190 until you cancel.")).toBeVisible();
      await expect(planCard(page, "Max").getByText("Save $158 a year vs monthly")).toBeVisible();
      await expect(planCard(page, "Launch").getByText("Billed monthly only")).toBeVisible();
      await axeClean(page, "plan");
      await fits(page);
      await planCard(page, "Free").getByRole("button", { name: "Continue with Free" }).click();

      await expect(heading(page, "Before your first request")).toBeVisible();
      await expect(page.getByRole("switch", { name: "Monthly spending limit" })).toBeChecked();
      await expect(page.getByLabel("Monthly limit in US dollars")).toHaveValue("25");
      await axeClean(page, "safety");
      await fits(page);
      const go = page.getByRole("button", { name: "Go to my console" });
      await expect(go).toBeDisabled();
      await page.getByLabel("I understand Satelink is not investment advice.").check();
      await page.getByLabel("I've read how Satelink uses my data.").check();
      await go.click();

      await expect(page).toHaveURL(/\/\?task=market-data$/);
      const first = page.getByRole("link", { name: /Get market data/ });
      await expect(first.getByText("Your first step")).toBeVisible();
      await axeClean(page, "home");

      const consents = await harness<{ purpose: string; granted: boolean; document_version: string; ip: string; ip_source: string }[]>(`/__seed/consents?account=${acct}`);
      expect(consents.map((c) => [c.purpose, c.granted, c.document_version])).toEqual([
        ["terms", true, "2.0"], ["acceptable_use", true, "2.0"], ["age_18_plus", true, "2.0"], ["dpdp_processing", true, "2.0"], ["product_updates", false, "2.0"],
      ]);
      expect(new Set(consents.map((c) => `${c.ip}/${c.ip_source}`))).toEqual(new Set([`${CLIENT_IP}/console_forwarded`]));
      expect(Number((await harness<{ monthly_spend_cap_usdt: string }>(`/__seed/settings?account=${acct}`)).monthly_spend_cap_usdt)).toBe(25);
      await page.context().close();
    });

    test("Launch: review → real Dodo TEST checkout → return shows pending → signed webhook confirms → home", async ({ browser, baseURL }) => {
      const acct = await seedUser("Arjun Mehta");
      const page = await open(browser, baseURL!, acct, vp);
      await page.goto("/welcome");
      await createAccount(page, { updates: true });
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByLabel("What will you use Satelink for?").selectOption({ label: "An AI agent that needs market data" });
      await page.getByRole("radio", { name: /Give my software access/ }).check();
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(planCard(page, "Launch").getByText("Recommended for you")).toBeVisible();
      await expect(planCard(page, "Launch").getByText("$5 for your first month. Renews at $19/month until you cancel.")).toBeVisible();
      await planCard(page, "Launch").getByRole("button", { name: "Choose Launch" }).click();

      await expect(heading(page, "Review and pay")).toBeVisible();
      for (const [k, v] of [["Plan", "Launch"], ["Billing period", "Monthly"], ["Subtotal", "$5.00 (first month)"], ["Total today", "$5.00 + applicable tax"]]) {
        await expect(page.getByRole("definition").filter({ hasText: v }).first()).toBeVisible();
        await expect(page.getByRole("term").filter({ hasText: k }).first()).toBeVisible();
      }
      await expect(page.getByText(/\$19\.00 \+ tax per month/)).toBeVisible();
      await expect(page.getByText(/Cancel anytime from Billing/)).toBeVisible();
      await axeClean(page, "review");
      await fits(page);
      const pay = page.getByRole("button", { name: "Continue to payment" });
      await expect(pay).toBeDisabled();
      await page.getByLabel(/I authorise recurring charges/).check();
      await pay.click();
      await page.waitForURL(/test\.checkout\.dodopayments\.com/, { timeout: 30_000 });

      // Back from Dodo: the return URL alone confirms nothing.
      await page.goto("/welcome?checkout=done");
      await expect(heading(page, "Confirming your payment")).toBeVisible();
      await expect(page.getByRole("status")).toContainText("Pending");
      await axeClean(page, "payment pending");
      await page.reload();
      await expect(heading(page, "Confirming your payment")).toBeVisible();

      // Dodo's webhook (signed, delivered to the real handler) is what confirms it.
      const plans = await (await fetch(`${HARNESS}/v2/plans`)).json();
      const launch = plans.data.plans.find((p: { id: string }) => p.id === "launch");
      expect(launch.purchasable).toBe(true);
      const catalog = await (await fetch(`${HARNESS}/v2/plans`)).json();
      const productId = await harness<{ product: string }>(`/__seed/product?id=launch`).then((x) => x.product);
      const w = await fetch(`${HARNESS}/__seed/webhook`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "subscription.active", data: { subscription_id: `sub_${acct}`, product_id: productId, next_billing_date: new Date(Date.now() + 30 * 864e5).toISOString(), metadata: { satelink_checkout: "v2", satelink_user_id: acct, satelink_product_id: "launch", satelink_plan_version: catalog.data.version } } }),
      }).then((r) => r.json());
      expect(w.outcome).toBe("entitlement_active");

      await expect(heading(page, "Before your first request")).toBeVisible({ timeout: 15_000 });
      await page.getByLabel("I understand Satelink is not investment advice.").check();
      await page.getByLabel("I've read how Satelink uses my data.").check();
      await page.getByRole("button", { name: "Go to my console" }).click();
      await expect(page).toHaveURL(/\/\?task=agent-access$/);
      await expect(page.getByRole("link", { name: /Give my software access/ }).getByText("Your first step")).toBeVisible();

      const consents = await harness<{ purpose: string; granted: boolean; document_version: string }[]>(`/__seed/consents?account=${acct}`);
      expect(consents.find((c) => c.purpose === "product_updates")?.granted).toBe(true);
      expect(consents.find((c) => c.purpose === "recurring_charges")).toMatchObject({ granted: true, document_version: "1.0" });
      await page.context().close();
    });
  });
}

test("resume mid-flow: a fresh browser continues at the step the account reached", async ({ browser, baseURL }) => {
  const acct = await seedUser("Meera Iyer");
  const first = await open(browser, baseURL!, acct, VIEWPORTS[0]);
  await first.goto("/");
  await createAccount(first);
  await first.getByLabel("Your name").fill("Meera I.");
  await first.getByRole("button", { name: "Continue" }).click();
  await expect(heading(first, "What will you use Satelink for?")).toBeVisible();
  await first.context().close();

  const second = await open(browser, baseURL!, acct, VIEWPORTS[1]); // a different browser, a phone
  await second.goto("/");
  await expect(second).toHaveURL(/\/welcome$/);
  await expect(heading(second, "What will you use Satelink for?")).toBeVisible();
  await second.getByRole("button", { name: "Back" }).click();
  await expect(second.getByLabel("Your name")).toHaveValue("Meera I.");
  await second.context().close();
});

test("India: plans say rupees, GST included (country from the edge header)", async ({ browser, baseURL }) => {
  const acct = await seedUser("Kavya Nair");
  const page = await open(browser, baseURL!, acct, VIEWPORTS[1], { "x-vercel-ip-country": "IN" });
  await page.goto("/welcome");
  await createAccount(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("What will you use Satelink for?").selectOption({ label: "Automated trading (bots and strategies)" });
  await page.getByRole("radio", { name: /I'll explore myself/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("In India you pay in rupees, GST included — Dodo Payments shows the rupee amount at checkout.")).toBeVisible();
  await expect(planCard(page, "Pro").getByText("Recommended for you")).toBeVisible();
  await page.context().close();
});
