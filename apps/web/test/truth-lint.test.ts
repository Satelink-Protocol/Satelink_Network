// Truth lint (§2.4 / §9) — guards the reposition's public copy against banned
// trading-advice language, fake "—" stat values, and Dodo surfaces missing a
// compliance disclosure. Scans (marketing)/(checkout) .tsx with comments
// stripped (comments aren't rendered, and #398-style refs must not trip it).
//
// Scoping note: bare "returns"/"alpha" from the §2.4 list are NOT enforced as
// blanket word bans — "returns derived statistics" is the APPROVED phrasing
// (used verbatim on the #398 success page), so a blanket ban would flag
// compliant copy. We enforce the unambiguous marketing phrases plus the
// trading-term \balpha\b and "guaranteed returns" (see docs/web/DECISIONS.md).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "src", "app");
const SCOPED = [join(ROOT, "(marketing)"), join(ROOT, "(checkout)")];

const BANNED: RegExp[] = [
  /signals to profit/i,
  /beat the market/i,
  /\bwin rate\b/i,
  /\bguaranteed\b/i,
  /guaranteed returns/i,
  /buy\s*\/?\s*sell recommendation/i,
  /\bbuy recommendation\b/i,
  /\bsell recommendation\b/i,
  /\bget rich\b/i,
  /\balpha\b/i,
];

function walkTsx(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTsx(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// Legal pages (terms/privacy/refund/contact) legitimately use words like
// "guaranteed" in disclaimers (negating guarantees) and discuss Dodo as part
// of their legal text — they are excluded from the marketing-copy bans.
const LEGAL = ["/terms", "/privacy", "/refund", "/contact"];

describe("truth lint (§2.4)", () => {
  const files = SCOPED.flatMap((d) => walkTsx(d));
  const productFiles = files.filter((f) => !LEGAL.some((l) => f.includes(l)));

  it("scans the marketing + checkout pages", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it("contains no banned trading-advice phrases", () => {
    const offenders: string[] = [];
    for (const f of productFiles) {
      const body = stripComments(readFileSync(f, "utf8"));
      for (const re of BANNED) {
        const m = body.match(re);
        if (m) offenders.push(`${f}: "${m[0]}"`);
      }
    }
    expect(offenders, `banned phrases found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("never passes a literal em-dash as a stat value", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const body = stripComments(readFileSync(f, "utf8"));
      if (/value=\{?["']—["']\}?/.test(body)) offenders.push(f);
    }
    expect(offenders, `em-dash stat value found in:\n${offenders.join("\n")}`).toEqual([]);
  });

  // Product/checkout surfaces that mention Dodo must carry a compliance
  // Disclosure. Legal pages are excluded (see LEGAL above).
  it("every product/checkout page mentioning Dodo renders a compliance Disclosure", () => {
    const offenders: string[] = [];
    for (const f of productFiles) {
      const body = stripComments(readFileSync(f, "utf8"));
      if (!/\bDodo\b/.test(body)) continue;
      if (!/<Disclosure\b/.test(body)) offenders.push(f);
    }
    expect(offenders, `Dodo mentioned without a <Disclosure> in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
