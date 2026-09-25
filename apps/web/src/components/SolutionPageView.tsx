// Generic solution page (§7 SolutionTemplate order): Hero · Problem · Why now ·
// How Satelink works · Two-sided (buyers/sellers, optional) · Capabilities ·
// Implementation ("Choose how you build") · Use cases · Proof (auto-hidden —
// we have no customer proof to show) · FAQ (grouped) · Related products · CTA.
// Server component. Solutions never mention Dodo; security claims stay factual.
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@satelink/web-ui";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { PRODUCTS, type ProductSlug } from "@/lib/products";
import type { SolutionFacts } from "@/lib/solutions";

export function SolutionPageView({ solution }: { solution: SolutionFacts }) {
  const crumbLabel = solution.kind === "company" ? "By company" : "By use case";
  const related = solution.relatedProducts
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .map((s: ProductSlug) => PRODUCTS[s]);

  return (
    <>
      <Breadcrumbs items={[{ name: "Solutions", href: "/solutions" }, { name: solution.name, href: `/solutions/${solution.slug}` }]} />

      {/* Hero */}
      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Solutions · {crumbLabel}</p>
        <h1 className="mt-3 max-w-[24ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">{solution.name}</h1>
        <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-sl-text-muted">{solution.definition}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg"><Link href="/contact-sales">Talk to Satelink <ArrowRight className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="lg"><Link href="/developers/quickstart">Start building</Link></Button>
        </div>
      </section>

      {/* Problem + Why now */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <SectionHeader eyebrow="The problem" title="What's hard today" align="left" as="h2" />
            <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">{solution.problem}</p>
          </div>
          {solution.whyNow && (
            <div>
              <SectionHeader eyebrow="Why now" title="What changed" align="left" as="h2" />
              <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">{solution.whyNow}</p>
            </div>
          )}
        </div>
      </section>

      {/* How Satelink works */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="How Satelink works" title="The flow" align="left" as="h2" />
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {solution.how.map((step, i) => (
              <li key={step} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
                <span className="font-sl-mono text-sm text-sl-text-subtle">0{i + 1}</span>
                <p className="mt-2 text-sm text-sl-text-muted">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Two-sided */}
      {solution.twoSided && (
        <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Two sides" title="Machine buyers and sellers" align="left" as="h2" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Card><CardTitle>Machine buyers</CardTitle><p className="mt-2 text-sm text-sl-text-muted">{solution.twoSided.buyers}</p></Card>
            <Card><CardTitle>Machine sellers</CardTitle><p className="mt-2 text-sm text-sl-text-muted">{solution.twoSided.sellers}</p></Card>
          </div>
        </section>
      )}

      {/* Capabilities */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Capabilities" title="What you get" align="left" as="h2" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {solution.capabilities.map((c) => (
              <div key={c} className="flex items-start gap-2.5 rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4 text-sm text-sl-text-muted">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sl-accent" />{c}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Implementation */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Choose how you build" title="Implementation paths" align="left" as="h2" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {solution.implementation.map((p) => (
            <div key={p.title} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sl-text">{p.title}</p>
                {p.status && <span className="rounded bg-sl-warn/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sl-warn">{p.status}</span>}
              </div>
              <p className="mt-1.5 text-sm text-sl-text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Use cases */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Use cases" title="Where teams apply it" align="left" as="h2" />
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {solution.useCases.map((u) => (
              <li key={u} className="rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4 text-sm text-sl-text-muted">{u}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ grouped */}
      <section className="mx-auto max-w-[820px] px-4 py-16 sm:px-6">
        <SectionHeader title="Frequently asked" align="left" as="h2" />
        {solution.faq.map((g) => (
          <div key={g.group} className="mt-8 first:mt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{g.group}</p>
            <div className="mt-3 space-y-3">
              {g.items.map(([q, a]) => <Disclosure key={q} title={q}>{a}</Disclosure>)}
            </div>
          </div>
        ))}
      </section>

      {/* Related products */}
      {related.length > 0 && (
        <section className="border-t border-sl-border bg-sl-bg-raised">
          <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
            <SectionHeader eyebrow="Related" title="Products behind this solution" align="left" as="h2" />
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {related.map((p) => (
                <Link key={p.href} href={p.href} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 transition-colors hover:border-sl-accent">
                  <p className="font-semibold text-sl-text">{p.name}</p>
                  <p className="mt-1.5 text-sm text-sl-text-muted">{p.tagline}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface px-6 py-12 text-center">
          <h2 className="font-sl-display text-[1.75rem] font-normal leading-tight tracking-[-0.01em] text-sl-text">See Satelink for {solution.name.toLowerCase()}</h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg"><Link href="/contact-sales">Talk to Satelink</Link></Button>
            <Button asChild variant="secondary" size="lg"><Link href="/pricing">See pricing</Link></Button>
          </div>
        </div>
      </section>
    </>
  );
}
