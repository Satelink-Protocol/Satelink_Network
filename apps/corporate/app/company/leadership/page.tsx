import type { Metadata } from "next";
import { publishedPeople } from "@/content/people";
import { Container, EmptyState, PageHero, ArrowLink } from "@/components/Page";

export const metadata: Metadata = {
  title: "Leadership",
  description: "The people who lead Jakuraa.",
};

export default function LeadershipPage() {
  const people = publishedPeople();
  return (
    <>
      <PageHero eyebrow="Company" title="Leadership" />
      <Container>
        {people.length === 0 ? (
          <EmptyState
            title="Profiles are on their way"
            body="We publish leadership profiles only with each person's consent. Statutory company details are available now."
            action={<ArrowLink href="/legal/company-information">Company information</ArrowLink>}
          />
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-2xl border border-stone-1 bg-stone-1 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((p) => (
              <li key={p.name} className="bg-ivory p-8">
                <p className="font-serif text-2xl">{p.name}</p>
                <p className="mt-1 text-sm text-green">{p.role}</p>
                {p.bio && <p className="mt-4 leading-relaxed text-stone-4">{p.bio}</p>}
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  );
}
