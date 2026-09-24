import type { Metadata } from "next";
import Link from "next/link";
import { businesses } from "@/content/businesses";
import { Illustration } from "@/components/Illustration";
import { StatusBadge } from "@/components/StatusBadge";
import { Container, PageHero } from "@/components/Page";

export const metadata: Metadata = {
  title: "Businesses",
  description: "Jakuraa's businesses: Satelink technology, trading and distribution, international trade, industrial manufacturing, and publishing.",
};

const legend: [string, string][] = [
  ["Operating", "Running today, serving users."],
  ["Registered capability", "Covered by our constitution or a government registration; not yet actively trading."],
  ["Planned", "Something we intend to do. Nothing is live yet."],
];

export default function BusinessesPage() {
  return (
    <>
      <PageHero
        eyebrow="Businesses"
        title="One company, several lines of business."
        lede={<p>Jakuraa is the parent company. Each business below is based on our Memorandum of Association or a government registration, and is labelled by its current status.</p>}
      />
      <Container>
        <dl className="mb-12 grid gap-4 text-sm sm:grid-cols-3">
          {legend.map(([k, v]) => (
            <div key={k} className="rounded-xl border border-stone-1 p-4">
              <dt><StatusBadge status={k as "Operating"} /></dt>
              <dd className="mt-2 text-stone-4">{v}</dd>
            </div>
          ))}
        </dl>
        <ul className="divide-y divide-stone-1 border-y border-stone-1">
          {businesses.map((b) => (
            <li key={b.slug}>
              <Link href={`/businesses/${b.slug}`} className="group grid items-center gap-6 py-10 sm:grid-cols-[200px_1fr_auto]">
                <Illustration kind={b.illustration} className="h-28 w-auto text-stone-3 group-hover:text-green" />
                <div>
                  <StatusBadge status={b.status} />
                  <h2 className="mt-3 font-serif text-3xl">{b.name}</h2>
                  <p className="mt-2 max-w-2xl text-stone-4">{b.summary}</p>
                </div>
                <span aria-hidden="true" className="hidden text-2xl text-stone-3 group-hover:text-green sm:block">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}
