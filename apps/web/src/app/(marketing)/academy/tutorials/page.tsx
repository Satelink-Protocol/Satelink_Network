// /academy/tutorials — grouped by product. Draft ("Available soon") pill on any
// tutorial without a live endpoint (none currently — all four are live).
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { tutorialsByProduct } from "@/lib/academy";
import { SectionHeader } from "@/components/ui/SectionHeader";

export const metadata: Metadata = buildMetadata({
  title: "Tutorials — Academy",
  description: "Runnable Satelink tutorials, grouped by product: discovery, derived metrics, RPC, and keyless x402 payments. Every tutorial is backed by a live endpoint.",
  path: "/academy/tutorials",
});

export default function TutorialsIndex() {
  const groups = tutorialsByProduct();
  return (
    <>
      <Breadcrumbs items={[{ name: "Academy", href: "/academy" }, { name: "Tutorials", href: "/academy/tutorials" }]} />
      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6">
        <SectionHeader eyebrow="Academy" title="Tutorials" align="left" lede="Grouped by product. Each runs against a live endpoint." />
      </section>
      <section className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
        {Object.entries(groups).map(([product, list]) => (
          <div key={product} className="mt-10 first:mt-0">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{product}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((t) => (
                <Link key={t.slug} href={`/academy/tutorials/${t.slug}`} className="flex flex-col rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 transition-colors hover:border-sl-accent">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sl-text">{t.title}</p>
                    {!t.live && <span className="rounded bg-sl-warn/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sl-warn">Available soon</span>}
                  </div>
                  <p className="mt-1.5 flex-1 text-sm text-sl-text-muted">{t.summary}</p>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent">Start <ArrowRight className="size-3.5" /></span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
