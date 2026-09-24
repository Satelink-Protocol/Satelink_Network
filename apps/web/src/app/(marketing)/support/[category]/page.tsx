// /support/[category] — articles in a collection. Only non-empty collections
// are pre-rendered; empty/unknown 404.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { nonEmptyCollections, getCollection, articlesInCollection } from "@/lib/support";
import { SectionHeader } from "@/components/ui/SectionHeader";

export function generateStaticParams() {
  return nonEmptyCollections().map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const c = getCollection(category);
  if (!c) return { title: "Support" };
  return buildMetadata({ title: `${c.name} — Support`, description: c.description, path: `/support/${category}` });
}

export default async function SupportCategory({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const c = getCollection(category);
  const articles = articlesInCollection(category);
  if (!c || articles.length === 0) notFound();

  return (
    <>
      <Breadcrumbs items={[{ name: "Support", href: "/support" }, { name: c.name, href: `/support/${category}` }]} />
      <section className="mx-auto max-w-[820px] px-4 pt-6 sm:px-6">
        <SectionHeader eyebrow="Support" title={c.name} align="left" lede={c.description} />
      </section>
      <section className="mx-auto max-w-[820px] px-4 py-10 sm:px-6">
        <ul className="divide-y divide-sl-border rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface">
          {articles.map((a) => (
            <li key={a.slug}>
              <Link href={`/support/${category}/${a.slug}`} className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-sl-text-muted transition-colors hover:text-sl-text">
                <span className="font-medium text-sl-text">{a.title}</span>
                <ArrowRight className="size-3.5 shrink-0 text-sl-accent" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
