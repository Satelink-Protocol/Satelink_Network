import type { Metadata } from "next";
import Link from "next/link";
import { sortedNews } from "@/content/people";
import { Container, EmptyState, PageHero, formatDate } from "@/components/Page";

export const metadata: Metadata = {
  title: "News",
  description: "Announcements from Jakuraa and Satelink.",
};

export default function NewsPage() {
  const items = sortedNews();
  return (
    <>
      <PageHero eyebrow="News" title="News" lede={<p>Announcements from Jakuraa and its businesses.</p>} />
      <Container>
        {items.length === 0 ? (
          <EmptyState title="No announcements yet" body="When there is news, it will be published here." />
        ) : (
          <ul className="divide-y divide-stone-1 border-y border-stone-1">
            {items.map((n) => (
              <li key={n.slug}>
                <Link href={`/news/${n.slug}`} className="group grid gap-2 py-8 sm:grid-cols-[200px_1fr]">
                  <time dateTime={n.date} className="text-sm text-stone-3">{formatDate(n.date)}</time>
                  <span>
                    <span className="font-serif text-2xl group-hover:text-green">{n.title}</span>
                    <span className="mt-2 block max-w-2xl text-stone-4">{n.summary}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  );
}
