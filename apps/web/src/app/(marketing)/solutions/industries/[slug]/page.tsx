// /solutions/industries/[slug] — the industry layer (§8). Data-driven from
// lib/solutions.ts; static params over the seven audited industries. No
// invented customers/metrics.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { getIndustry, INDUSTRY_ORDER } from "@/lib/solutions";
import { PRODUCTS } from "@/lib/products";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";

export function generateStaticParams() {
  return INDUSTRY_ORDER.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const ind = getIndustry(slug);
  if (!ind) return { title: "Industry" };
  return buildMetadata({ title: `${ind.name} — Satelink solutions`, description: ind.definition, path: `/solutions/industries/${slug}` });
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ind = getIndustry(slug);
  if (!ind) notFound();
  const related = ind.relatedProducts.map((s) => PRODUCTS[s]);

  return (
    <>
      <Breadcrumbs items={[{ name: "Solutions", href: "/solutions" }, { name: ind.name, href: `/solutions/industries/${slug}` }]} />

      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Solutions · By industry</p>
        <h1 className="mt-3 max-w-[24ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">{ind.name}</h1>
        <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-sl-text-muted">{ind.definition}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg"><Link href="/contact-sales">Talk to Satelink <ArrowRight className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="lg"><Link href="/product/overview">Platform overview</Link></Button>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <p className="max-w-[68ch] text-base leading-relaxed text-sl-text-muted">{ind.body}</p>
      </section>

      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Use cases" title="How the sector uses it" align="left" as="h2" />
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {ind.useCases.map((u) => (
              <li key={u} className="rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4 text-sm text-sl-text-muted">{u}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Related" title="Products behind it" align="left" as="h2" />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {related.map((p) => (
            <Link key={p.href} href={p.href} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 transition-colors hover:border-sl-accent">
              <p className="font-semibold text-sl-text">{p.name}</p>
              <p className="mt-1.5 text-sm text-sl-text-muted">{p.tagline}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
