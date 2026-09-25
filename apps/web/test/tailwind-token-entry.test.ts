// Guard for AUDIT_2026-09-25 D1–D3: the Signal @theme block must be compiled by
// Tailwind, i.e. tokens.css must be @import-ed from the Tailwind entry
// (globals.css, after `@import "tailwindcss"`) — never imported separately from
// a layout, where Tailwind never sees it and no sl-* utility is generated.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("Tailwind token entry", () => {
  for (const app of ["apps/web/src/app", "apps/console/src/app"]) {
    it(`${app}/globals.css imports tokens.css after tailwindcss`, () => {
      const css = read(`${app}/globals.css`);
      const tw = css.indexOf('@import "tailwindcss"');
      const tokens = css.indexOf("packages/web-ui/src/styles/tokens.css");
      expect(tw).toBeGreaterThanOrEqual(0);
      expect(tokens).toBeGreaterThan(tw);
    });

    it(`${app}/layout.tsx does not import tokens.css outside Tailwind`, () => {
      expect(read(`${app}/layout.tsx`)).not.toMatch(/import\s+["'][^"']*tokens\.css["']/);
    });
  }

  it("tokens.css exposes the sl-* colours to Tailwind via @theme", () => {
    const css = read("packages/web-ui/src/styles/tokens.css");
    expect(css).toMatch(/@theme inline\s*{[^}]*--color-sl-surface:/);
    expect(css).toMatch(/@theme inline\s*{[^}]*--color-sl-accent:/);
  });
});
