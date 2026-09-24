// /changelog — dated, factual shipped changes (lib/resources.ts).
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@satelink/seo";
import { postsBySection } from "@/lib/resources";
import { ResourceHeader, EmptyResources } from "@/components/ResourceViews";

export const metadata: Metadata = buildMetadata({
  title: "Changelog",
  description: "What changed in Satelink, dated — the x402 rail, RevenueVaultV2, bundle pricing, and more. Only real, shipped changes.",
  path: "/changelog",
});

export default function ChangelogIndex() {
  const posts = postsBySection("changelog");
  return (
    <>
      <ResourceHeader eyebrow="Changelog" title="Every shipped change" />
      <section className="mx-auto max-w-[820px] px-4 py-10 sm:px-6">
        {posts.length === 0 ? <EmptyResources /> : (
          <ol className="space-y-6 border-l border-sl-border pl-6">
            {posts.map((p) => (
              <li key={p.slug} className="relative">
                <span className="absolute -left-[1.65rem] top-1.5 size-2 rounded-full bg-sl-accent" aria-hidden />
                <time dateTime={p.date} className="font-sl-mono text-xs text-sl-text-subtle">
                  {new Date(p.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                </time>
                <h2 className="mt-1 font-semibold text-sl-text">
                  <Link href={`/changelog/${p.slug}`} className="hover:text-sl-accent">{p.title}</Link>
                </h2>
                <p className="mt-1 text-sm text-sl-text-muted">{p.subtitle}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
