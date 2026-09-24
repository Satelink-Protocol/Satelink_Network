// Legal suite structure gate (web-v3 P4 / §5) — every policy has a plain-English
// summary, a version, an intro, and numbered sections; and every policy is
// >= 600 words except Cookies and Sub-processors (short by design). Operator
// Terms is network-scoped and exempt from the word floor.
import { describe, it, expect } from "vitest";
import { LEGAL, LEGAL_ORDER, type LegalDoc } from "@/lib/legal";

const SHORT_OK = new Set(["cookies", "sub-processors", "operator-terms"]);

function wordCount(doc: LegalDoc): number {
  const parts: string[] = [doc.intro, ...doc.summary];
  for (const s of doc.sections) {
    parts.push(s.heading);
    if (s.body) parts.push(...s.body);
    if (s.list) parts.push(...s.list);
    if (s.table) {
      parts.push(...s.table.headers);
      for (const row of s.table.rows) parts.push(...row);
    }
  }
  return parts.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

describe("legal suite structure (§5)", () => {
  it("the ten brief-specified policies all exist", () => {
    for (const slug of [
      "terms", "privacy", "billing-policy", "refund", "acceptable-use",
      "data-processing", "cookies", "security", "sub-processors", "responsible-disclosure",
    ]) {
      expect(LEGAL[slug], slug).toBeDefined();
    }
    expect(LEGAL_ORDER.length).toBe(10);
  });

  for (const [slug, doc] of Object.entries(LEGAL)) {
    describe(slug, () => {
      it("has a summary, version, intro, and sections", () => {
        expect(doc.summary.length, "summary").toBeGreaterThan(0);
        expect(doc.version, "version").toMatch(/\d/);
        expect(doc.intro.length, "intro").toBeGreaterThan(20);
        expect(doc.sections.length, "sections").toBeGreaterThan(0);
      });
      it(`meets its word floor`, () => {
        const words = wordCount(doc);
        const floor = SHORT_OK.has(slug) ? 120 : 600;
        expect(words, `${slug}: ${words} words (floor ${floor})`).toBeGreaterThanOrEqual(floor);
      });
    });
  }
});
