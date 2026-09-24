// /support/search — server-rendered results over the seeded articles.
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { searchArticles } from "@/lib/support";
import { EmptyResources } from "@/components/ResourceViews";

export const metadata: Metadata = buildMetadata({
  title: "Search support",
  description: "Search the Satelink support center.",
  path: "/support/search",
  noindex: true,
});

export default async function SupportSearch({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const results = searchArticles(q);
  return (
    <>
      <Breadcrumbs items={[{ name: "Support", href: "/support" }, { name: "Search", href: "/support/search" }]} />
      <section className="mx-auto max-w-[820px] px-4 py-10 sm:px-6">
        <form action="/support/search" method="get" className="flex gap-2">
          <input name="q" type="search" defaultValue={q} placeholder="Search support…" aria-label="Search support" className="flex-1 rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-4 py-2.5 text-sm text-sl-text focus:border-sl-accent focus:outline-none" />
          <button type="submit" className="rounded-[var(--sl-radius-sm)] bg-sl-accent px-4 py-2.5 text-sm font-semibold text-sl-accent-ink">Search</button>
        </form>
        <p className="mt-6 text-sm text-sl-text-subtle">{q ? `${results.length} result${results.length === 1 ? "" : "s"} for “${q}”` : "Type a query to search."}</p>
        {q && results.length === 0 ? (
          <div className="mt-4"><EmptyResources label="No articles matched." /></div>
        ) : (
          <ul className="mt-4 divide-y divide-sl-border rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface">
            {results.map((a) => (
              <li key={`${a.collection}/${a.slug}`}>
                <Link href={`/support/${a.collection}/${a.slug}`} className="block px-5 py-3.5 text-sm text-sl-text-muted transition-colors hover:text-sl-text">
                  <span className="font-medium text-sl-text">{a.title}</span>
                  <span className="ml-2 font-sl-mono text-xs text-sl-text-subtle">{a.collection}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
