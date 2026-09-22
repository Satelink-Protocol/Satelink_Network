// /solutions — hub. By company size, by use case, by industry. No invented
// customers or logos; cards link the real solution pages.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { SOLUTIONS, SOLUTIONS_BY_COMPANY, SOLUTIONS_BY_USECASE, INDUSTRIES, INDUSTRY_ORDER } from "@/lib/solutions";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = buildMetadata({
  title: "Solutions",
  description:
    "Satelink solutions by company size, use case, and industry: enterprise, startups, developers, AI-native; AI agents, commerce, machine commerce, trading, API monetization, automation.",
  path: "/solutions",
});

function Grid({ slugs, kind }: { slugs: string[]; kind: "solution" | "industry" }) {
  const get = kind === "solution" ? (s: string) => ({ name: SOLUTIONS[s].name, def: SOLUTIONS[s].definition, href: `/solutions/${s}` }) : (s: string) => ({ name: INDUSTRIES[s].name, def: INDUSTRIES[s].definition, href: `/solutions/industries/${s}` });
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {slugs.map((s) => {
        const c = get(s);
        return (
          <Card key={s} interactive className="flex flex-col">
            <CardTitle>{c.name}</CardTitle>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-sl-text-muted">{c.def}</p>
            <Link href={c.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
              Learn more <ArrowRight className="size-3.5" />
            </Link>
          </Card>
        );
      })}
    </div>
  );
}

export default function SolutionsHub() {
  return (
    <>
      <section className="mx-auto max-w-[1100px] px-4 pt-16 text-center sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Solutions</p>
        <h1 className="mx-auto mt-3 max-w-[22ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">
          Machine commerce, applied to your work.
        </h1>
        <p className="mx-auto mt-5 max-w-[60ch] text-lg text-sl-text-muted">
          The same rail — discover, pay, settle — framed for how you build and what you build.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg"><Link href="/contact-sales">Talk to Satelink <ArrowRight className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="lg"><Link href="/product/overview">Platform overview</Link></Button>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
        <SectionHeader eyebrow="By company" title="Where you are" align="left" as="h2" />
        <Grid slugs={SOLUTIONS_BY_COMPANY} kind="solution" />
      </section>

      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
          <SectionHeader eyebrow="By use case" title="What you're building" align="left" as="h2" />
          <Grid slugs={SOLUTIONS_BY_USECASE} kind="solution" />
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
        <SectionHeader eyebrow="By industry" title="Your sector" align="left" as="h2" />
        <Grid slugs={INDUSTRY_ORDER} kind="industry" />
      </section>
    </>
  );
}
