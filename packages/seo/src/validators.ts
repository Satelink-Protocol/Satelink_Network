// SEO/GEO validators (§12) — pure functions the `seo:check` CI job composes.
// CI-blocking checks: missing title/description/canonical, duplicate
// titles/descriptions/slugs/canonicals, missing alt text, invalid JSON-LD,
// orphan pages, broken internal links, sitemap drift.

export type PageRecord = {
  route: string;
  title?: string;
  description?: string;
  canonical?: string;
  /** Internal links this page points at (paths). */
  outbound?: string[];
  /** <img> alt presence per image; false = missing alt. */
  imageAlts?: boolean[];
  jsonLd?: unknown[];
};

export type Issue = { route: string; rule: string; detail: string };

export function checkRequiredMeta(pages: PageRecord[]): Issue[] {
  const issues: Issue[] = [];
  for (const p of pages) {
    if (!p.title) issues.push({ route: p.route, rule: "missing-title", detail: "no <title>" });
    if (!p.description)
      issues.push({ route: p.route, rule: "missing-description", detail: "no meta description" });
    if (!p.canonical)
      issues.push({ route: p.route, rule: "missing-canonical", detail: "no canonical" });
    for (const ok of p.imageAlts ?? []) {
      if (!ok) issues.push({ route: p.route, rule: "missing-alt", detail: "image without alt" });
    }
  }
  return issues;
}

function dup(field: (p: PageRecord) => string | undefined, rule: string, pages: PageRecord[]): Issue[] {
  const seen = new Map<string, string[]>();
  for (const p of pages) {
    const v = field(p);
    if (!v) continue;
    seen.set(v, [...(seen.get(v) ?? []), p.route]);
  }
  const issues: Issue[] = [];
  for (const [v, routes] of seen) {
    if (routes.length > 1)
      issues.push({ route: routes.join(", "), rule, detail: `duplicate: ${JSON.stringify(v)}` });
  }
  return issues;
}

export function checkDuplicates(pages: PageRecord[]): Issue[] {
  return [
    ...dup((p) => p.title, "duplicate-title", pages),
    ...dup((p) => p.description, "duplicate-description", pages),
    ...dup((p) => p.canonical, "duplicate-canonical", pages),
  ];
}

// Every published page must have ≥2 inbound internal links (§11 link-graph).
export function checkLinkGraph(pages: PageRecord[]): Issue[] {
  const routes = new Set(pages.map((p) => p.route));
  const inbound = new Map<string, number>();
  const issues: Issue[] = [];
  for (const p of pages) {
    for (const target of p.outbound ?? []) {
      const clean = target.split("#")[0].split("?")[0];
      if (!routes.has(clean) && clean.startsWith("/")) {
        issues.push({ route: p.route, rule: "broken-internal-link", detail: `→ ${target}` });
      } else {
        inbound.set(clean, (inbound.get(clean) ?? 0) + 1);
      }
    }
  }
  for (const p of pages) {
    if ((inbound.get(p.route) ?? 0) < 2)
      issues.push({ route: p.route, rule: "orphan", detail: "fewer than 2 inbound links" });
  }
  return issues;
}

export function checkJsonLd(pages: PageRecord[]): Issue[] {
  const issues: Issue[] = [];
  for (const p of pages) {
    for (const node of p.jsonLd ?? []) {
      if (typeof node !== "object" || node === null) {
        issues.push({ route: p.route, rule: "invalid-jsonld", detail: "non-object node" });
        continue;
      }
      const o = node as Record<string, unknown>;
      if (!o["@context"]) issues.push({ route: p.route, rule: "invalid-jsonld", detail: "no @context" });
      if (!o["@type"]) issues.push({ route: p.route, rule: "invalid-jsonld", detail: "no @type" });
    }
  }
  return issues;
}

export function checkSitemapDrift(sitemapRoutes: string[], pages: PageRecord[]): Issue[] {
  const inSitemap = new Set(sitemapRoutes);
  const known = new Set(pages.map((p) => p.route));
  const issues: Issue[] = [];
  for (const p of pages) {
    if (!inSitemap.has(p.route))
      issues.push({ route: p.route, rule: "sitemap-drift", detail: "published page missing from sitemap" });
  }
  for (const r of sitemapRoutes) {
    if (!known.has(r))
      issues.push({ route: r, rule: "sitemap-drift", detail: "sitemap route has no page" });
  }
  return issues;
}

export function runAllSeoChecks(pages: PageRecord[], sitemapRoutes: string[]): Issue[] {
  return [
    ...checkRequiredMeta(pages),
    ...checkDuplicates(pages),
    ...checkLinkGraph(pages),
    ...checkJsonLd(pages),
    ...checkSitemapDrift(sitemapRoutes, pages),
  ];
}
