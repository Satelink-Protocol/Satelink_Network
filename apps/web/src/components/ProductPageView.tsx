// Generic product page (§7 ProductTemplate order) driven by ProductFacts.
// Used for the four non-Dodo products (machine-commerce, rpc, x402, metering);
// Trading Intelligence has its own page because it is the only Dodo checkout
// surface. Server component — presentational, no invented numbers (the price
// line is passed in, resolved from the live catalog / documented constants).
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@satelink/web-ui";
import { productLd, breadcrumbLd, faqLd, jsonLdScript } from "@satelink/seo";
import { SITES } from "@satelink/content";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { CodeBlock } from "@/components/ui/CodeBlock";
import type { ProductFacts } from "@/lib/products";

export type RelatedLink = { name: string; href: string; tagline: string };

export function ProductPageView({
  product,
  priceLine,
  related,
  primaryCta = { label: "Start building", href: "/developers/quickstart" },
}: {
  product: ProductFacts;
  /** Live-resolved price line (falls back to product.priceLine). */
  priceLine?: string;
  related: RelatedLink[];
  primaryCta?: { label: string; href: string };
}) {
  const price = priceLine ?? product.priceLine;
  const url = `${SITES.satelink.origin}${product.href}`;
  const faqItems = product.faq.flatMap((g) => g.items.map((it) => ({ question: it.q, answer: it.a })));
  const ld = [
    productLd({ name: product.name, description: product.definition, url }),
    breadcrumbLd([
      { name: "Products", url: `${SITES.satelink.origin}/product/overview` },
      { name: product.name, url },
    ]),
    ...(faqItems.length ? [faqLd(faqItems)] : []),
  ];

  return (
    <>
      {/* Machine-readable alternate + JSON-LD (§12). Next hoists these to <head>. */}
      <link rel="alternate" type="application/json" href={`/products/${product.slug}.json`} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />
      <Breadcrumbs items={[{ name: "Products", href: "/product/overview" }, { name: product.name, href: product.href }]} />

      {/* Hero */}
      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">{product.name}</p>
        <h1 className="mt-3 max-w-[22ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">
          {product.tagline}
        </h1>
        <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-sl-text-muted">{product.definition}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg"><Link href={primaryCta.href}>{primaryCta.label} <ArrowRight className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="lg"><a href={product.docs}>Read the docs</a></Button>
        </div>
      </section>

      {/* Core value (3 cards) */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="grid gap-5 sm:grid-cols-3">
          {product.value.map((v) => (
            <Card key={v.title}>
              <CardTitle>{v.title}</CardTitle>
              <CardDescription>{v.body}</CardDescription>
            </Card>
          ))}
        </div>
      </section>

      {/* Product visual (example request) */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="A real request" title="What calling it looks like" align="left" />
          <div className="mt-6 max-w-3xl">
            <CodeBlock code={product.exampleRequest} ariaLabel={`${product.name} example request`} />
          </div>
          {product.endpoint && (
            <p className="mt-3 font-sl-mono text-xs text-sl-text-subtle">Endpoint: {product.endpoint}</p>
          )}
        </div>
      </section>

      {/* Capabilities grid */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Capabilities" title="What you get" align="left" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {product.capabilities.map((c) => (
            <div key={c} className="flex items-start gap-2.5 rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4 text-sm text-sl-text-muted">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sl-accent" />
              {c}
            </div>
          ))}
        </div>
      </section>

      {/* Integration paths — payment rails */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Choose how you pay" title="Payment rails" align="left" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {product.rails.map((r) => (
              <div key={r.id} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
                <p className="font-semibold text-sl-text">{r.label}</p>
                <p className="mt-1.5 text-sm text-sl-text-muted">{r.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing (live) */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Pricing" title="Pay per use" align="left" />
        <div className="mt-6 rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
          <p className="font-sl-mono text-2xl font-bold tabular-nums text-sl-text">{price}</p>
          <p className="mt-4 text-sm text-sl-text-muted">
            Full rate card and a usage calculator at{" "}
            <Link href="/pricing" className="text-sl-accent underline">/pricing</Link> ·{" "}
            <a href="https://satelink.network/pricing.json" className="font-sl-mono text-sl-accent underline">pricing.json</a>
          </p>
        </div>
      </section>

      {/* Machine-readable panel */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="For machines" title="Machine-readable facts" align="left" />
          <pre tabIndex={0} className="mt-6 overflow-x-auto rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-5 font-sl-mono text-xs leading-relaxed text-sl-text-muted">
            <code>{JSON.stringify({
              product: product.slug,
              endpoint: product.endpoint,
              discovery: product.discovery,
              auth: product.auth,
              payment_rails: product.rails.map((r) => r.id),
              docs: product.docs,
              pricing: `https://satelink.network/products/${product.slug}.json`,
            }, null, 2)}</code>
          </pre>
        </div>
      </section>

      {/* FAQ grouped */}
      <section className="mx-auto max-w-[820px] px-4 py-16 sm:px-6">
        <SectionHeader title="Frequently asked" align="left" />
        {product.faq.map((g) => (
          <div key={g.group} className="mt-8 first:mt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{g.group}</p>
            <div className="mt-3 space-y-3">
              {g.items.map((it) => (
                <Disclosure key={it.q} title={it.q}>{it.a}</Disclosure>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Related products */}
      {related.length > 0 && (
        <section className="border-t border-sl-border bg-sl-bg-raised">
          <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
            <SectionHeader eyebrow="Related" title="Explore the rest of the platform" align="left" />
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {related.map((r) => (
                <Link key={r.href} href={r.href} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 transition-colors hover:border-sl-accent">
                  <p className="font-semibold text-sl-text">{r.name}</p>
                  <p className="mt-1.5 text-sm text-sl-text-muted">{r.tagline}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface px-6 py-12 text-center">
          <h2 className="font-sl-display text-[1.75rem] font-normal leading-tight tracking-[-0.01em] text-sl-text">Start building with {product.name}</h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg"><Link href={primaryCta.href}>{primaryCta.label}</Link></Button>
            <Button asChild variant="secondary" size="lg"><Link href="/pricing">See pricing</Link></Button>
          </div>
        </div>
      </section>
    </>
  );
}
