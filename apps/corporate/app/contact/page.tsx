import type { Metadata } from "next";
import { company, registeredOfficeLine } from "@/content/company";
import { EnquiryForm } from "@/components/EnquiryForm";
import { Container, PageHero } from "@/components/Page";

export const metadata: Metadata = {
  title: "Contact",
  description: `Contact ${company.legalName} — registered office, business enquiries and grievances.`,
};

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title="Get in touch." lede={<p>For business enquiries, partnerships, press or anything about our businesses.</p>} />
      <Container className="grid gap-14 lg:grid-cols-[1.5fr_1fr]">
        <section aria-label="Enquiry form">
          <EnquiryForm fallbackEmail={company.email} />
        </section>
        <aside className="space-y-10 text-stone-4">
          <div>
            <h2 className="text-sm font-medium text-ink">Registered office</h2>
            <address className="mt-3 not-italic leading-relaxed">
              {company.legalName}
              <br />
              <span className="text-sm">(formerly {company.formerName})</span>
              <br />
              {registeredOfficeLine()}
            </address>
          </div>
          <div>
            <h2 className="text-sm font-medium text-ink">Email</h2>
            <a href={`mailto:${company.email}`} className="link-u mt-3 inline-block">{company.email}</a>
            {company.phone && (
              <>
                <h2 className="mt-6 text-sm font-medium text-ink">Telephone</h2>
                <a href={`tel:${company.phone.replace(/\s/g, "")}`} className="link-u mt-3 inline-block">{company.phone}</a>
              </>
            )}
          </div>
          <div>
            <h2 className="text-sm font-medium text-ink">Using Satelink?</h2>
            <p className="mt-3">Product support and documentation are at <a href="https://satelink.network" className="link-u">satelink.network</a>.</p>
          </div>
          <div>
            <h2 className="text-sm font-medium text-ink">Grievances</h2>
            <p className="mt-3">See <a href="/legal/grievance" className="link-u">Grievance officer</a>.</p>
          </div>
          <p className="text-xs">CIN {company.cin} · GSTIN {company.gstin}</p>
        </aside>
      </Container>
    </>
  );
}
