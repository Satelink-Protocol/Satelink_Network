// /search — global search results page (§5, §14). Server-rendered from the
// shared index; the ⌘K palette is the interactive path.
import type { Metadata } from "next";
import Link from "next/link";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { searchIndex } from "@/lib/search-index";

export const metadata: Metadata = {
  title: "Search",
  description: "Search Satelink — products, platform, developers, academy, and support.",
  alternates: { canonical: "https://satelink.network/search" },
};

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const hits = searchIndex(q, 24);

  return (
    <div className="mx-auto max-w-[900px] px-4 py-16 sm:px-6">
      <SectionHeader eyebrow="Search" title={q ? `Results for “${q}”` : "Search Satelink"} />
      <form className="mt-6" action="/search" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search products, docs, academy…"
          aria-label="Search query"
          className="h-12 w-full rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface px-4 text-sm text-sl-text outline-none focus:border-sl-accent"
        />
      </form>

      <div className="mt-8">
        {q && hits.length === 0 && <p className="text-sm text-sl-text-subtle">No results. Try a different term, or press ⌘K.</p>}
        <ul className="divide-y divide-sl-border">
          {hits.map((h) => (
            <li key={h.href}>
              <Link href={h.href} className="flex flex-col gap-1 py-4 transition-colors hover:bg-sl-surface">
                <span className="flex items-center gap-2 text-sm font-medium text-sl-text">
                  {h.title}
                  <span className="rounded bg-sl-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sl-text-subtle">{h.type}</span>
                </span>
                {h.excerpt && <span className="text-sm text-sl-text-muted">{h.excerpt}</span>}
                <span className="text-xs text-sl-text-subtle">{h.href}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
