// /academy — hub: Courses · Tutorials · Use cases.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { TUTORIALS, USE_CASES, COURSES } from "@/lib/academy";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";

export const metadata: Metadata = buildMetadata({
  title: "Academy",
  description: "Learn to build on Satelink: runnable tutorials backed by live endpoints, real-world use cases, and courses. Pay-per-call machine commerce, hands-on.",
  path: "/academy",
});

export default function AcademyHub() {
  const sections = [
    { name: "Tutorials", body: `Runnable, endpoint-backed walkthroughs (${TUTORIALS.length}).`, href: "/academy/tutorials" },
    { name: "Use cases", body: `Real scenarios mapped to products (${USE_CASES.length}).`, href: "/academy/use-cases" },
    { name: "Courses", body: COURSES.length ? `${COURSES.length} structured courses.` : "Structured courses — available soon.", href: "/academy/courses" },
  ];
  return (
    <>
      <section className="mx-auto max-w-[1100px] px-4 pt-16 text-center sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Academy</p>
        <h1 className="mx-auto mt-3 max-w-[22ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">Learn machine commerce by doing.</h1>
        <p className="mx-auto mt-5 max-w-[60ch] text-lg text-sl-text-muted">Every tutorial runs against a live endpoint. Start with discovery and work up to keyless payments.</p>
      </section>
      <section className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {sections.map((s) => (
            <Card key={s.name} interactive className="flex flex-col">
              <CardTitle>{s.name}</CardTitle>
              <p className="mt-2 flex-1 text-sm text-sl-text-muted">{s.body}</p>
              <Link href={s.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">Open <ArrowRight className="size-3.5" /></Link>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
