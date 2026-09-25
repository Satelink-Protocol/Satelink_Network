import { test, expect } from "@playwright/test";

// Customer auth is unified on the console (2026-09-25): satelink.network /login
// and /signup hand off to console.satelink.network/sign-in (claude.ai/login
// pattern: Google, email + magic link, legal line). 307 keeps it reversible.
// Staff sign-in is unchanged at /ops/login. The sign-in UI itself is covered
// by apps/console/e2e/sign-in.spec.ts.

test("/login → console sign-in (307, not followed)", async ({ request }) => {
  const r = await request.get("/login", { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(r.headers()["location"]).toBe("https://console.satelink.network/sign-in");
});

test("/signup → console sign-in in sign-up mode (307, not followed)", async ({ request }) => {
  const r = await request.get("/signup", { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(r.headers()["location"]).toBe("https://console.satelink.network/sign-in?mode=signup");
});

test("/ops/login (staff) is never handed to the console", async ({ request }) => {
  const r = await request.get("/ops/login", { maxRedirects: 0 });
  expect(r.headers()["location"] ?? "").not.toContain("console.satelink.network");
});
