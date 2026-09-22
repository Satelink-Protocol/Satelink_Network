import { test, expect } from "@playwright/test";

// Checkout E2E (§9). The Dodo session endpoint is mocked so no real payment is
// created; we assert the UI gates (summary, consent, redirect) and the #398
// claim behaviour.
test("checkout: summary renders; consent gates pay; redirect uses the session URL", async ({ page }) => {
  await page.route("**/api/dodo-checkout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, checkoutUrl: "https://checkout.dodopayments.com/mock-session" }),
    });
  });

  // Keep the test hermetic: the hand-off target is a real external domain, so
  // stub it — otherwise the live Dodo site 302-redirects an unknown path away
  // from /mock-session and the URL assertion never settles.
  await page.route("https://checkout.dodopayments.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>mock</title>" })
  );

  await page.goto("/checkout?plan=starter");

  // Order summary is visible with the product + one-time framing.
  await expect(page.getByText("Satelink Trading Intelligence")).toBeVisible();
  await expect(page.getByText(/one-time/i).first()).toBeVisible();

  // Step 1: email required to continue.
  await page.getByLabel("Email").fill("buyer@example.com");
  await page.getByRole("button", { name: /continue/i }).click();

  // Step 2: pay is disabled until consent is checked.
  const pay = page.getByRole("button", { name: /continue to secure payment/i });
  await expect(pay).toBeDisabled();
  await page.getByLabel(/I agree to the/i).check();
  await expect(pay).toBeEnabled();

  // Clicking pay navigates to the (mocked) Dodo session URL.
  await Promise.all([
    page.waitForURL(/checkout\.dodopayments\.com\/mock-session/),
    pay.click(),
  ]);
});

test("checkout: retryable error when session creation fails", async ({ page }) => {
  await page.route("**/api/dodo-checkout", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false }) })
  );
  await page.goto("/checkout?plan=starter");
  await page.getByLabel("Email").fill("buyer@example.com");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByLabel(/I agree to the/i).check();
  await page.getByRole("button", { name: /continue to secure payment/i }).click();
  await expect(page.getByText(/couldn't start the secure payment/i)).toBeVisible();
});

test("intelligence/success with a stale ?account= shows 'Missing claim reference'", async ({ page }) => {
  await page.goto("/intelligence/success?account=stale-value");
  await expect(page.getByText(/Missing claim reference/i)).toBeVisible();
});

test("checkout/cancel reassures the buyer they weren't charged", async ({ page }) => {
  await page.goto("/checkout/cancel");
  await expect(page.getByText(/haven't been charged/i)).toBeVisible();
});
