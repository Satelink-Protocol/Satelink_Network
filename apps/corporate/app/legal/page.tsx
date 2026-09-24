import type { Metadata } from "next";
import Link from "next/link";
import { legalNav } from "@/components/LegalLayout";
import { Container, PageHero } from "@/components/Page";

export const metadata: Metadata = { title: "Legal", description: "Company information, privacy, terms of use and grievance redressal for Jakuraa." };

const blurbs: Record<string, string> = {
  "/legal/company-information": "Statutory details disclosed under Rule 26 of the Companies (Incorporation) Rules, 2014.",
  "/legal/privacy": "What this website collects, why, and your rights under the Digital Personal Data Protection Act, 2023.",
  "/legal/terms": "The terms that apply to your use of jakuraa.com.",
  "/legal/grievance": "How to raise a grievance and who handles it.",
};

export default function LegalIndex() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Legal" />
      <Container>
        <ul className="grid gap-px overflow-hidden rounded-2xl border border-stone-1 bg-stone-1 sm:grid-cols-2">
          {legalNav.map((n) => (
            <li key={n.href} className="bg-ivory">
              <Link href={n.href} className="block h-full p-8 hover:bg-ivory-2">
                <p className="font-serif text-2xl">{n.label}</p>
                <p className="mt-2 text-stone-4">{blurbs[n.href]}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}
