import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Sign-in (claude.ai/login pattern) at every breakpoint and theme: one serif
// headline, Continue with Google, email + magic link, legal line; no
// horizontal scroll; the page follows the console theme (AUDIT D11); axe clean.
const WIDTHS = [360, 390, 768, 1024, 1440];
const THEMES = ["light", "dark"] as const;

for (const width of WIDTHS) for (const theme of THEMES) {
  test(`sign-in ${width}px ${theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "slc_theme", value: theme, url: baseURL! }]);
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const bg = await page.locator("main").evaluate((m) => getComputedStyle(m).backgroundColor);
    // light bg is #FAF9F5, dark bg is #0F0F0E
    expect(bg).toBe(theme === "light" ? "rgb(250, 249, 245)" : "rgb(15, 15, 14)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`sign-in-${width}-${theme}.png`) });
  });
}

test("sign-up mode changes the words only", async ({ page }) => {
  await page.goto("/sign-in?mode=signup");
  await expect(page.getByRole("heading", { level: 1, name: "Give your software a way to pay" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});
