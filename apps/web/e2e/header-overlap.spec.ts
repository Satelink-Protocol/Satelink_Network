import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Gate for AUDIT_2026-09-25 D1/D4/D6 (unified design system): at every
// breakpoint and in both themes —
//   · no horizontal page scroll,
//   · header controls fit inside the viewport and never overlap each other,
//   · an open mega-menu is an opaque sheet above the hero: hit-testing the
//     centre of (menu ∩ hero H1) lands inside the menu, and the uncovered
//     page lands on the backdrop — so hero text is never legible through it,
//   · on mobile the drawer covers the whole viewport,
//   · axe finds no serious/critical violations.
// Visual snapshots are written to test-results for the PR before/after set.

const WIDTHS = [360, 390, 768, 1024, 1440] as const;
const THEMES = ["light", "dark"] as const;
const PAGES = ["/", "/pricing", "/product/overview"] as const;

async function open(page: Page, path: string, width: number, theme: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((t) => { try { localStorage.setItem("satelink-theme", t); } catch {} }, theme);
  await page.goto(path);
  await expect(page.getByRole("banner")).toBeVisible();
}

type Box = { x: number; y: number; w: number; h: number; label: string };

async function headerBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-sl-header] a, [data-sl-header] button")]
      .filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden")
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, label: (e.getAttribute("aria-label") || e.textContent || "").trim() };
      })
  );
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width}px ${theme}`, () => {
      for (const path of PAGES) {
        test(`${path}: no horizontal scroll`, async ({ page }) => {
          await open(page, path, width, theme);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${path} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
        });
      }

      test("header controls fit and do not overlap", async ({ page }) => {
        await open(page, "/", width, theme);
        const boxes = await headerBoxes(page);
        const vp = { x: 0, y: 0, w: width, h: 900, label: "viewport" };
        for (const b of boxes) expect(contains(vp, b), `"${b.label}" is clipped at ${width}px`).toBe(true);
        // The wordmark link contains its own mark; compare only siblings.
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++)
            expect(intersects(boxes[i], boxes[j]), `"${boxes[i].label}" overlaps "${boxes[j].label}"`).toBe(false);
        await page.screenshot({ path: test.info().outputPath(`home-${width}-${theme}.png`) });
      });

      if (width >= 1024) {
        for (const menu of ["Products", "Solutions", "Developers", "Resources"]) {
          test(`mega-menu "${menu}" is opaque and covers the hero`, async ({ page }) => {
            await open(page, "/", width, theme);
            await page.getByRole("banner").getByRole("button", { name: menu }).click();
            const panel = page.locator("[data-sl-menu]");
            await expect(panel).toBeVisible();
            await page.waitForTimeout(400); // reveal animation

            const result = await page.evaluate(() => {
              const panel = document.querySelector<HTMLElement>("[data-sl-menu]")!;
              const bg = getComputedStyle(panel).backgroundColor;
              const alpha = bg.startsWith("rgba") ? Number(bg.split(",")[3].replace(")", "")) : 1;
              const p = panel.getBoundingClientRect();
              const h1 = document.querySelector("main h1")!.getBoundingClientRect();
              const ix = Math.max(p.left, h1.left), iy = Math.max(p.top, h1.top);
              const ax = Math.min(p.right, h1.right), ay = Math.min(p.bottom, h1.bottom);
              let overlapHit: string | null = null;
              if (ax > ix && ay > iy) {
                const el = document.elementFromPoint((ix + ax) / 2, (iy + ay) / 2);
                overlapHit = el && panel.contains(el) ? "menu" : el?.tagName ?? "none";
              }
              const below = document.elementFromPoint(window.innerWidth / 2, Math.min(window.innerHeight - 5, p.bottom + 40));
              return { alpha, overlapHit, belowIsBackdrop: !!below?.closest("[data-sl-backdrop]") };
            });
            expect(result.alpha, "menu background must be opaque").toBe(1);
            if (result.overlapHit) expect(result.overlapHit, "hero shows through the menu").toBe("menu");
            expect(result.belowIsBackdrop, "page under an open menu must sit behind the backdrop").toBe(true);
            await page.screenshot({ path: test.info().outputPath(`megamenu-${menu}-${width}-${theme}.png`) });
          });
        }
      } else {
        test("mobile drawer covers the viewport and traps focus", async ({ page }) => {
          await open(page, "/", width, theme);
          await page.getByRole("button", { name: "Open menu" }).click();
          const drawer = page.getByRole("dialog", { name: "Menu" });
          await expect(drawer).toBeVisible();
          const box = (await drawer.boundingBox())!;
          expect(box.x).toBe(0);
          expect(box.y).toBe(0);
          expect(Math.round(box.width)).toBe(width);
          expect(Math.round(box.height)).toBe(900);
          for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
          expect(await drawer.evaluate((d) => d.contains(document.activeElement))).toBe(true);
          await page.keyboard.press("Escape");
          await expect(drawer).toBeHidden();
          await page.screenshot({ path: test.info().outputPath(`drawer-${width}-${theme}.png`) });
        });
      }

      test("axe: no serious or critical violations on home", async ({ page }) => {
        await open(page, "/", width, theme);
        // Cast: @axe-core/playwright resolves a second playwright-core copy in this monorepo.
        const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(bad.map((v) => `${v.id}: ${v.nodes.length} node(s) — ${v.nodes[0]?.target}`)).toEqual([]);
      });
    });
  }
}
