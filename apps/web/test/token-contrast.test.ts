// WCAG AA contrast gate (P1 §2.1) — every text / primary-action token pair in
// BOTH themes must meet AA (4.5:1 for normal text). Values are parsed from the
// real tokens.css so drift is caught. The product-rail colours (machine/market/
// settle) are graphical accents always paired with a text-muted label, so they
// are covered by the graphical-object threshold, not tested here as body text
// (see docs/web/DECISIONS.md).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(
  resolve(__dirname, "..", "..", "..", "packages", "web-ui", "src", "styles", "tokens.css"),
  "utf8"
);

function section(startMarker: string, endMarker: string): string {
  const start = CSS.indexOf(startMarker);
  const end = CSS.indexOf(endMarker, start + startMarker.length);
  return CSS.slice(start, end === -1 ? undefined : end);
}

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--sl-[a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) if (!(m[1] in out)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const light = tokens(section('[data-theme="light"] {', '[data-theme="dark"] {'));
const dark = tokens(section('[data-theme="dark"] {', "@media"));

const AA = 4.5;

describe("token contrast (WCAG AA, §2.1)", () => {
  for (const [name, t] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    describe(name, () => {
      it("parses the palette", () => {
        expect(t["--sl-text"]).toMatch(/^#/);
        expect(t["--sl-accent"]).toMatch(/^#/);
      });

      const pairs: Array<[string, string, string]> = [
        ["text on bg", "--sl-text", "--sl-bg"],
        ["text on surface", "--sl-text", "--sl-surface"],
        ["text-muted on bg", "--sl-text-muted", "--sl-bg"],
        ["text-muted on surface", "--sl-text-muted", "--sl-surface"],
        ["text-subtle on bg", "--sl-text-subtle", "--sl-bg"],
        ["text-subtle on surface", "--sl-text-subtle", "--sl-surface"],
        ["accent-ink on accent (primary button)", "--sl-accent-ink", "--sl-accent"],
        ["accent as text on bg", "--sl-accent", "--sl-bg"],
        ["accent as text on surface", "--sl-accent", "--sl-surface"],
      ];

      for (const [label, fg, bg] of pairs) {
        it(`${label} meets AA (>=${AA})`, () => {
          const r = ratio(t[fg], t[bg]);
          expect(r, `${label}: ${t[fg]} on ${t[bg]} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
        });
      }
    });
  }
});
