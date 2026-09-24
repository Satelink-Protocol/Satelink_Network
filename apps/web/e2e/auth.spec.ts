import { test, expect } from "@playwright/test";

// Auth UI gate (web-v3 P5 / §6.3): redesigned /login and /signup with a
// provider button, email form, consent notice, states, and the staff pointer
// to /ops/login. The Better Auth backend is Track B; with auth disabled,
// social/magic-link/new-account controls show a "rolling out" state (no dead
// controls). Supported sign-in (A6): Google + email — Apple is out for now.

test("/login: Google provider, email form, staff pointer, no 'admin access', no Apple", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Apple/ })).toHaveCount(0);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in at \/ops\/login/ })).toHaveAttribute("href", "/ops/login");
  await expect(page.getByText(/admin access/i)).toHaveCount(0);
});

test("/login: a disabled provider shows a 'rolling out' state, not a dead button", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Continue with Google/ }).click();
  await expect(page.getByText(/rolling out/i)).toBeVisible();
});

test("/signup: consent is required before creating an account", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  const create = page.getByRole("button", { name: "Create account" });
  await expect(create).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(create).toBeEnabled();
});
