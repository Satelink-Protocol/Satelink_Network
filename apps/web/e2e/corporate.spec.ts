import { test, expect } from "@playwright/test";

// Corporate enquiry E2E (§9): validation, success path, and that the honeypot
// field is hidden. Rate-limit (429) is covered by the route unit test; here we
// assert the client behaviour.
test("corporate: validation errors block submit", async ({ page }) => {
  await page.goto("/corporate#enquire");
  await page.getByRole("button", { name: /send enquiry/i }).click();
  await expect(page.getByText(/enter a valid work email/i)).toBeVisible();
});

test("corporate: happy path shows inline confirmation", async ({ page }) => {
  await page.route("**/api/corporate-enquiry", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  );
  await page.goto("/corporate#enquire");
  await page.getByLabel(/Name/).fill("Ada Lovelace");
  await page.getByLabel("Work email").fill("ada@fund.example");
  await page.getByLabel("Company").fill("Analytical Engines");
  await page.getByLabel("Use case").selectOption({ index: 1 });
  await page.getByLabel("Expected monthly call volume").selectOption({ index: 1 });
  await page.getByLabel(/I agree to be contacted/i).check();
  await page.getByRole("button", { name: /send enquiry/i }).click();
  await expect(page.getByText(/your enquiry is in/i)).toBeVisible();
});

test("corporate: honeypot field is not visible to users", async ({ page }) => {
  await page.goto("/corporate#enquire");
  await expect(page.locator("#website")).toBeHidden();
});

test("corporate: rate-limited response surfaces a friendly message", async ({ page }) => {
  await page.route("**/api/corporate-enquiry", (route) =>
    route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, error: "rate_limited" }) })
  );
  await page.goto("/corporate#enquire");
  await page.getByLabel(/Name/).fill("Ada Lovelace");
  await page.getByLabel("Work email").fill("ada@fund.example");
  await page.getByLabel("Company").fill("Analytical Engines");
  await page.getByLabel("Use case").selectOption({ index: 1 });
  await page.getByLabel("Expected monthly call volume").selectOption({ index: 1 });
  await page.getByLabel(/I agree to be contacted/i).check();
  await page.getByRole("button", { name: /send enquiry/i }).click();
  await expect(page.getByText(/too many requests/i)).toBeVisible();
});
