import type { Metadata } from "next";
import { openRoles } from "@/content/people";
import { company } from "@/content/company";
import { Container, EmptyState, PageHero, SectionHeading } from "@/components/Page";

export const metadata: Metadata = {
  title: "Careers",
  description: "How Jakuraa hires, and current open roles.",
};

const principles: [string, string][] = [
  ["Work that is real", "You will work on things that exist and are used, and you will be told plainly what is and isn't working."],
  ["Small and accountable", "We are a small company. Everyone owns outcomes end to end."],
  ["Written first", "Decisions, designs and trade-offs are written down so anyone can follow the reasoning."],
];

const process: [string, string][] = [
  ["Application", "Send a short note about something you have built or run, and why this role."],
  ["Conversation", "A call about your work and ours — no trick questions."],
  ["Practical exercise", "Where relevant, a short exercise that resembles the actual work."],
  ["Decision", "We let you know the outcome."],
];

const faq: [string, string][] = [
  ["Where is the company based?", "Our registered office is in Coimbatore, Tamil Nadu. Where each role is based is stated on the role itself."],
  ["Can I apply if no role fits?", `Yes — write to ${company.email} with the subject "Careers". We read every note, though we cannot promise a role.`],
  ["Will you ever ask me for money?", "No. Jakuraa never asks candidates for payment at any stage of hiring. Treat any such request as fraudulent."],
];

export default function CareersPage() {
  return (
    <>
      <PageHero eyebrow="Careers" title="Build things that are true." lede={<p>We hire rarely and deliberately. Here is how we work and how we hire.</p>} />

      <section className="border-t border-stone-1 py-20">
        <Container>
          <SectionHeading title="How we work" />
          <div className="mt-10 grid gap-10 sm:grid-cols-3">
            {principles.map(([t, b]) => (
              <div key={t}>
                <h3 className="font-serif text-2xl">{t}</h3>
                <p className="mt-3 leading-relaxed text-stone-4">{b}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-ivory-2 py-20">
        <Container>
          <SectionHeading title="How we hire" />
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {process.map(([t, b], i) => (
              <li key={t} className="border-t-2 border-green pt-5">
                <p className="text-sm text-amber-ink">0{i + 1}</p>
                <h3 className="mt-1 font-serif text-xl">{t}</h3>
                <p className="mt-2 leading-relaxed text-stone-4">{b}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section aria-labelledby="roles" className="py-20">
        <Container>
          <SectionHeading id="roles" title="Open roles" />
          <div className="mt-10">
            {openRoles.length === 0 ? (
              <EmptyState title="No open roles right now" body={`We are not hiring for specific roles at the moment. You are welcome to write to ${company.email}.`} />
            ) : (
              <ul className="divide-y divide-stone-1 border-y border-stone-1">
                {openRoles.map((r) => (
                  <li key={r.slug} className="grid gap-2 py-6 sm:grid-cols-[1fr_200px]">
                    <div>
                      <p className="font-serif text-2xl">{r.title}</p>
                      <p className="mt-1 text-stone-4">{r.summary}</p>
                    </div>
                    <p className="text-sm text-stone-3 sm:text-right">{r.location}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Container>
      </section>

      <section className="border-t border-stone-1 py-20">
        <Container>
          <SectionHeading title="Questions" />
          <div className="mt-8 max-w-3xl divide-y divide-stone-1 border-y border-stone-1">
            {faq.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer items-center justify-between gap-4 font-serif text-xl">
                  {q}
                  <span aria-hidden="true" className="text-stone-3 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 leading-relaxed text-stone-4">{a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
