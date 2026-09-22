// /support — search hero + collection grid (empty collections hidden) + popular.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { nonEmptyCollections, articlesInCollection, ARTICLES } from "@/lib/support";
import { Card, CardTitle } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";

export const metadata: Metadata = buildMetadata({
  title: "Support",
  description: "Satelink support center: getting started, API, payments, x402, credits, Trading Intelligence, RPC, and security. Real answers from the docs.",
  path: "/support",
});

export default function SupportHome() {
  const collections = nonEmptyCollections();
  const popular = ARTICLES.slice(0, 4);
  return (
    <>
      <section className="border-b border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[900px] px-4 py-16 text-center sm:px-6">
          <h1 className="text-4xl font-bold tracking-tight text-sl-text">How can we help?</h1>
          <form action="/support/search" method="get" className="mx-auto mt-6 flex max-w-xl gap-2">
            <input name="q" type="search" placeholder="Search support…" aria-label="Search support" className="flex-1 rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-4 py-2.5 text-sm text-sl-text focus:border-sl-accent focus:outline-none" />
            <button type="submit" className="rounded-[var(--sl-radius-sm)] bg-sl-accent px-4 py-2.5 text-sm font-semibold text-sl-accent-ink">Search</button>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
        <SectionHeader eyebrow="Collections" title="Browse by topic" align="left" as="h2" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c) => (
            <Card key={c.slug} interactive className="flex flex-col">
              <CardTitle className="text-base">{c.name}</CardTitle>
              <p className="mt-2 flex-1 text-sm text-sl-text-muted">{c.description}</p>
              <Link href={`/support/${c.slug}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
                {articlesInCollection(c.slug).length} article{articlesInCollection(c.slug).length === 1 ? "" : "s"} <ArrowRight className="size-3.5" />
              </Link>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
          <SectionHeader eyebrow="Popular" title="Frequently read" align="left" as="h2" />
          <ul className="mt-6 divide-y divide-sl-border rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface">
            {popular.map((a) => (
              <li key={a.slug}>
                <Link href={`/support/${a.collection}/${a.slug}`} className="flex items-center justify-between gap-3 px-5 py-3.5 text-sm text-sl-text-muted transition-colors hover:text-sl-text">
                  {a.title} <ArrowRight className="size-3.5 text-sl-accent" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
