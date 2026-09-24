// /academy/courses — no structured courses exist yet; honest empty state.
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { COURSES } from "@/lib/academy";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyResources } from "@/components/ResourceViews";

export const metadata: Metadata = buildMetadata({
  title: "Courses — Academy",
  description: "Structured Satelink courses. Available soon — start with the runnable tutorials in the meantime.",
  path: "/academy/courses",
});

export default function CoursesIndex() {
  return (
    <>
      <Breadcrumbs items={[{ name: "Academy", href: "/academy" }, { name: "Courses", href: "/academy/courses" }]} />
      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6">
        <SectionHeader eyebrow="Academy" title="Courses" align="left" />
      </section>
      <section className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
        {COURSES.length === 0 ? (
          <EmptyResources label="Structured courses are available soon." />
        ) : null}
        <p className="mt-6 text-sm text-sl-text-muted">
          In the meantime, the <Link href="/academy/tutorials" className="text-sl-accent underline">tutorials</Link> are runnable today.
        </p>
      </section>
    </>
  );
}
