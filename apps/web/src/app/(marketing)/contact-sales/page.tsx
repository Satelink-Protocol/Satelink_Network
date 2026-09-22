// /contact-sales — enterprise enquiry intake (§8). Reuses the same validated,
// rate-limited handler pattern as corporate-enquiry; persists to CMS Enquiries
// when wired. No fabricated response times or SLAs.
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@satelink/seo";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ContactSalesForm } from "./ContactSalesForm";

export const metadata: Metadata = buildMetadata({
  title: "Contact sales",
  description: "Talk to Satelink about dedicated keys, spend controls, usage attribution, and consolidated invoicing for your team.",
  path: "/contact-sales",
});

export default function ContactSalesPage() {
  return (
    <>
      <section className="mx-auto max-w-[900px] px-4 pt-16 sm:px-6">
        <SectionHeader eyebrow="Contact sales" title="Talk to Satelink" lede="Dedicated keys, spend and usage controls, per-key attribution, and consolidated invoicing through a corporate engagement." align="left" />
        <p className="mt-4 max-w-[60ch] text-sm text-sl-text-muted">
          Prefer to start on your own? Everything is self-serve and pay-per-call —{" "}
          <Link href="/developers/quickstart" className="text-sl-accent underline">start with the quickstart</Link> or{" "}
          <Link href="/pricing" className="text-sl-accent underline">see pricing</Link>.
        </p>
      </section>
      <section className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6 sm:p-8">
          <ContactSalesForm />
        </div>
      </section>
    </>
  );
}
