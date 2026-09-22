// /academy/use-cases/[slug] — scenario, flow, products, and linked tutorials.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { USE_CASES, getUseCase, getTutorial } from "@/lib/academy";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";

export function generateStaticParams() {
  return USE_CASES.map((u) => ({ slug: u.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const u = getUseCase(slug);
  if (!u) return { title: "Use case" };
  return buildMetadata({ title: `${u.title} — Academy`, description: u.scenario, path: `/academy/use-cases/${slug}` });
}

export default async function UseCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const u = getUseCase(slug);
  if (!u) notFound();
  const tutorials = u.tutorials.map(getTutorial).filter(Boolean) as NonNullable<ReturnType<typeof getTutorial>>[];

  return (
    <>
      <Breadcrumbs items={[{ name: "Academy", href: "/academy" }, { name: "Use cases", href: "/academy/use-cases" }, { name: u.title, href: `/academy/use-cases/${u.slug}` }]} />
      <section className="mx-auto max-w-[900px] px-4 pt-6 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-sl-text">{u.title}</h1>
        <p className="mt-4 text-lg text-sl-text-muted">{u.scenario}</p>
      </section>

      <section className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
        <SectionHeader eyebrow="Flow" title="Step by step" align="left" as="h2" />
        <ol className="mt-6 space-y-3 border-l border-sl-border pl-6">
          {u.flow.map((step, i) => (
            <li key={step} className="relative">
              <span className="absolute -left-[1.65rem] top-1.5 size-2 rounded-full bg-sl-accent" aria-hidden />
              <span className="font-sl-mono text-xs text-sl-text-subtle">0{i + 1}</span>
              <p className="mt-0.5 text-sm text-sl-text-muted">{step}</p>
            </li>
          ))}
        </ol>

        <SectionHeader eyebrow="Products used" title="What it runs on" align="left" as="h2" className="mt-12" />
        <div className="mt-4 flex flex-wrap gap-2">
          {u.products.map((p) => (
            <Link key={p.href} href={p.href} className="rounded-[var(--sl-radius-sm)] border border-sl-border px-3 py-1.5 text-sm text-sl-text-muted hover:border-sl-accent hover:text-sl-text">{p.label}</Link>
          ))}
        </div>

        {tutorials.length > 0 && (
          <>
            <SectionHeader eyebrow="Try it" title="Related tutorials" align="left" as="h2" className="mt-12" />
            <div className="mt-4 flex flex-wrap gap-3">
              {tutorials.map((t) => (
                <Button key={t.slug} asChild variant="secondary"><Link href={`/academy/tutorials/${t.slug}`}>{t.title}</Link></Button>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
