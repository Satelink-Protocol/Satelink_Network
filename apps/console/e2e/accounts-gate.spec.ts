import { test, expect, type Browser, type BrowserContext } from "@playwright/test";

// CONSOLE_ACCOUNTS_V1 gate: the same account in three isolated browser profiles
// ("Chrome" with keys left in its per-browser cookie by the old console,
// "Brave", and a fresh profile) shows identical keys — and a change made in any
// one appears in the others. Runs against a console built with
// CONSOLE_ACCOUNTS_V1=true and the local harness API
// (apps/api/test/harness/console_accounts_harness.mjs):
//   ACCOUNTS_E2E=1 PW_BASE_URL=http://localhost:3412 HARNESS_URL=http://127.0.0.1:4455 npx playwright test e2e/accounts-gate.spec.ts
test.skip(!process.env.ACCOUNTS_E2E, "needs the accounts harness");
test.describe.configure({ mode: "serial" });

const HARNESS = process.env.HARNESS_URL || "http://127.0.0.1:4455";
const ACCOUNT = "acct_demo";

async function profile(browser: Browser, baseURL: string, legacyKeys?: { k: string; label: string }[]) {
  const ctx = await browser.newContext();
  const url = new URL(baseURL);
  const cookies = [{ name: "satelink.session_token", value: ACCOUNT, domain: url.hostname, path: "/" }];
  if (legacyKeys) {
    const value = encodeURIComponent(JSON.stringify(legacyKeys.map((x) => ({ ...x, addedAt: new Date().toISOString() }))));
    cookies.push({ name: "slc_keys", value, domain: url.hostname, path: "/" });
  }
  await ctx.addCookies(cookies);
  return ctx;
}

async function keyRows(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.goto("/keys");
  const rows = await page
    .locator("table tbody tr")
    .evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 5).map((td) => td.textContent?.trim())));
  await page.close();
  return rows;
}

test("same keys on Chrome, Brave and a fresh profile; changes propagate", async ({ browser, baseURL }) => {
  const seed = await (
    await fetch(`${HARNESS}/__seed/key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credits: 2.5 }) })
  ).json();

  // "Chrome": the old console left a key in this browser's cookie.
  const chrome = await profile(browser, baseURL!, [{ k: seed.key, label: "legacy bot" }]);
  const page = await chrome.newPage();
  await page.goto("/keys");
  const banner = page.getByRole("region", { name: "Keys saved in this browser" });
  await expect(banner).toContainText("1 key is saved only in this browser");
  await page.getByRole("button", { name: "Save to my account" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "legacy bot" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "$2.5000" })).toBeVisible();
  // The per-browser store is retired.
  expect((await chrome.cookies()).some((c) => c.name === "slc_keys")).toBe(false);

  const brave = await profile(browser, baseURL!);
  const fresh = await profile(browser, baseURL!);
  const [a, b, c] = await Promise.all([keyRows(chrome), keyRows(brave), keyRows(fresh)]);
  expect(a.length).toBe(1);
  expect(b).toEqual(a);
  expect(c).toEqual(a);

  // Create in "Brave" → visible in "Chrome" and the fresh profile.
  const bp = await brave.newPage();
  await bp.goto("/keys");
  await bp.getByRole("button", { name: "Create key" }).click();
  await bp.getByLabel("Key name").fill("pricing-bot");
  await bp.getByRole("button", { name: "Create free key" }).click();
  await expect(bp.getByText("Copy this key now")).toBeVisible();
  const issued = await bp.locator("code").first().textContent();
  expect(issued).toMatch(/^sk_free_[0-9a-f]{48}$/);
  await bp.getByRole("button", { name: "Done" }).click();

  // Pause the legacy key from the fresh profile.
  const fp = await fresh.newPage();
  await fp.goto("/keys");
  await fp.getByRole("row", { name: /legacy bot/ }).getByRole("button", { name: "Pause" }).click();
  await expect(fp.getByRole("row", { name: /legacy bot/ })).toContainText("paused");

  const [a2, b2, c2] = await Promise.all([keyRows(chrome), keyRows(brave), keyRows(fresh)]);
  expect(a2.length).toBe(2);
  expect(b2).toEqual(a2);
  expect(c2).toEqual(a2);
  expect(JSON.stringify(a2)).toContain("paused");
  // No full key is ever rendered in the list.
  expect(JSON.stringify(a2)).not.toContain(issued!);
  expect(JSON.stringify(a2)).not.toContain(seed.key);
  await page.reload();
  await page.screenshot({ path: test.info().outputPath("accounts-keys.png"), fullPage: true });
});
