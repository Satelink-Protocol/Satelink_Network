// /academy/use-cases — real scenarios mapped to products + tutorials.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { USE_CASES } from "@/lib/academy";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";

export const metadata: Metadata = buildMetadata({
  title: "Use cases — Academy",
  description: "Real machine-commerce scenarios: agent purchasing, trading intelligence, M2M payments, usage-based SaaS, API monetization, and enterprise procurement.",
  path: "/academy/use-cases",
});

export default function UseCasesIndex() {
  return (
    <>
      <Breadcrumbs items={[{ name: "Academy", href: "/academy" }, { name: "Use cases", href: "/academy/use-cases" }]} />
      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6">
        <SectionHeader eyebrow="Academy" title="Use cases" align="left" lede="How teams apply the rail, end to end." />
      </section>
      <section className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((u) => (
            <Card key={u.slug} interactive className="flex flex-col">
              <CardTitle className="text-base">{u.title}</CardTitle>
              <p className="mt-2 flex-1 text-sm text-sl-text-muted">{u.scenario}</p>
              <Link href={`/academy/use-cases/${u.slug}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">See the flow <ArrowRight className="size-3.5" /></Link>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
