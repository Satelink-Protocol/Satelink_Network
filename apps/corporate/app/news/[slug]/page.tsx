import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNews, news } from "@/content/people";
import { ArrowLink, Container, formatDate } from "@/components/Page";

export function generateStaticParams() {
  return news.map((n) => ({ slug: n.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const n = getNews((await params).slug);
  return n ? { title: n.title, description: n.summary } : {};
}

export default async function NewsArticle({ params }: { params: Promise<{ slug: string }> }) {
  const n = getNews((await params).slug);
  if (!n) notFound();
  return (
    <Container className="pb-8 pt-12 sm:pt-20">
      <article className="mx-auto max-w-2xl">
        <nav aria-label="Breadcrumb" className="text-sm text-stone-3">
          <Link href="/news" className="hover:text-ink">News</Link>
        </nav>
        <time dateTime={n.date} className="mt-8 block text-sm text-amber-ink">{formatDate(n.date)}</time>
        <h1 className="mt-3 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">{n.title}</h1>
        <p className="mt-6 text-xl leading-relaxed text-stone-4">{n.summary}</p>
        <div className="prose-j mt-10 border-t border-stone-1 pt-10 text-lg leading-relaxed">
          {n.body.map((p) => <p key={p}>{p}</p>)}
        </div>
        {n.source && <p className="mt-10"><ArrowLink href={n.source.href}>{n.source.label}</ArrowLink></p>}
      </article>
    </Container>
  );
}
