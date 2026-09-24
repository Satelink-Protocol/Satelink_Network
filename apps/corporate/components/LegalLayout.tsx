import Link from "next/link";
import { Container } from "./Page";

const nav = [
  { href: "/legal/company-information", label: "Company information" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms of use" },
  { href: "/legal/grievance", label: "Grievance officer" },
];

export const LEGAL_UPDATED = "24 September 2026";

export function LegalPage({ title, current, children }: { title: string; current: string; children: React.ReactNode }) {
  return (
    <Container className="grid gap-12 pb-8 pt-12 sm:pt-20 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Legal" className="text-sm lg:sticky lg:top-24 lg:self-start">
        <Link href="/legal" className="font-medium text-ink">Legal</Link>
        <ul className="mt-4 space-y-2.5">
          {nav.map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={current === n.href ? "page" : undefined} className={current === n.href ? "text-green" : "text-stone-4 hover:text-ink"}>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="max-w-3xl">
        <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-stone-3">Last updated {LEGAL_UPDATED}</p>
        <div className="legal mt-10 space-y-5 leading-relaxed text-stone-4 [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:text-ink [&_a]:underline [&_a]:decoration-stone-2 [&_a]:underline-offset-4 hover:[&_a]:decoration-green [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          {children}
        </div>
      </article>
    </Container>
  );
}

export { nav as legalNav };
