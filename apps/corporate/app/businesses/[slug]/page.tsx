import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { businesses, getBusiness, scopeFor } from "@/content/businesses";
import { Illustration } from "@/components/Illustration";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLink, Container } from "@/components/Page";

export function generateStaticParams() {
  return businesses.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const b = getBusiness((await params).slug);
  return b ? { title: b.name, description: b.summary } : {};
}

export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const b = getBusiness((await params).slug);
  if (!b) notFound();
  const others = businesses.filter((o) => o.slug !== b.slug);

  return (
    <>
      <Container className="grid gap-10 pb-16 pt-12 sm:pt-20 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <nav aria-label="Breadcrumb" className="text-sm text-stone-3">
            <Link href="/businesses" className="hover:text-ink">Businesses</Link> <span aria-hidden="true">/</span> {b.short}
          </nav>
          <div className="mt-6"><StatusBadge status={b.status} /></div>
          <h1 className="mt-4 font-serif text-[2.5rem] leading-[1.08] tracking-tight sm:text-6xl">{b.name}</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-4 sm:text-xl">{b.summary}</p>
        </div>
        <Illustration kind={b.illustration} className="w-full max-w-sm justify-self-center text-green" />
      </Container>

      <Container className="grid gap-14 border-t border-stone-1 pt-14 lg:grid-cols-[1.4fr_1fr]">
        <div className="prose-j max-w-2xl text-lg leading-relaxed text-stone-4">
          {b.body.map((p) => <p key={p}>{p}</p>)}
          {b.externalUrl && (
            <p className="pt-4"><ArrowLink href={b.externalUrl}>Visit {new URL(b.externalUrl).host}</ArrowLink></p>
          )}
        </div>
        <aside className="space-y-8">
          <div>
            <h2 className="text-sm font-medium text-ink">Scope</h2>
            <ul className="mt-3 space-y-2 text-stone-4">
              {scopeFor(b).map((s) => <li key={s} className="border-b border-stone-1 pb-2">{s}</li>)}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-medium text-ink">Basis</h2>
            <p className="mt-3 text-sm leading-relaxed text-stone-4">{b.basis}</p>
          </div>
        </aside>
      </Container>

      <section aria-labelledby="other" className="mt-24 border-t border-stone-1 pt-16">
        <Container>
          <h2 id="other" className="font-serif text-2xl">Other businesses</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {others.map((o) => (
              <li key={o.slug}>
                <Link href={`/businesses/${o.slug}`} className="block h-full rounded-xl border border-stone-1 p-5 hover:border-stone-3">
                  <StatusBadge status={o.status} />
                  <p className="mt-3 font-serif text-lg">{o.short}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>
    </>
  );
}
