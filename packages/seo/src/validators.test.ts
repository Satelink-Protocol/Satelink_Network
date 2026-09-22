import { describe, it, expect } from "vitest";
import {
  checkRequiredMeta,
  checkDuplicates,
  checkLinkGraph,
  checkJsonLd,
  checkSitemapDrift,
} from "./validators";

describe("seo validators", () => {
  it("flags missing title/description/canonical and missing alt", () => {
    const issues = checkRequiredMeta([
      { route: "/a", title: "A", description: "d", canonical: "/a", imageAlts: [true, false] },
      { route: "/b" },
    ]);
    const rules = issues.map((i) => i.rule).sort();
    expect(rules).toContain("missing-alt");
    expect(rules).toContain("missing-title");
    expect(rules).toContain("missing-description");
    expect(rules).toContain("missing-canonical");
  });

  it("detects duplicate titles and canonicals", () => {
    const issues = checkDuplicates([
      { route: "/a", title: "Same", canonical: "/x" },
      { route: "/b", title: "Same", canonical: "/x" },
    ]);
    expect(issues.some((i) => i.rule === "duplicate-title")).toBe(true);
    expect(issues.some((i) => i.rule === "duplicate-canonical")).toBe(true);
  });

  it("flags orphans (<2 inbound) and broken internal links", () => {
    const issues = checkLinkGraph([
      { route: "/hub", outbound: ["/a", "/a", "/missing"] },
      { route: "/a", outbound: ["/hub", "/hub"] },
    ]);
    expect(issues.some((i) => i.rule === "broken-internal-link")).toBe(true);
    // /hub has 2 inbound from /a; /a has 2 inbound from /hub → neither orphan.
    expect(issues.some((i) => i.rule === "orphan" && i.route === "/a")).toBe(false);
  });

  it("rejects JSON-LD nodes without @context/@type", () => {
    const issues = checkJsonLd([{ route: "/p", jsonLd: [{ "@type": "WebPage" }, { "@context": "x" }] }]);
    expect(issues.length).toBe(2);
  });

  it("detects sitemap drift both directions", () => {
    const issues = checkSitemapDrift(["/a", "/ghost"], [{ route: "/a" }, { route: "/b" }]);
    expect(issues.some((i) => i.detail.includes("missing from sitemap"))).toBe(true);
    expect(issues.some((i) => i.detail.includes("no page"))).toBe(true);
  });
});
