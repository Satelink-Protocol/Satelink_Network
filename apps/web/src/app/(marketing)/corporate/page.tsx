// /corporate — Corporate Services: the second commercial line. Sells via an
// enquiry form → email (§3). No public price (§2.7). Describes only
// capabilities that exist on the same public-data pipeline; no SLAs/uptime
// guarantees are published (§2.7).
import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, LineChart, Plug, Receipt, ArrowRight, ShieldCheck } from "lucide-react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { EnquiryForm } from "./EnquiryForm";

export const metadata: Metadata = {
  title: "Corporate Services",
  description:
    "Market data services for teams that build on them: dedicated API keys, custom derived metrics on the same public-data pipeline, integration support, and consolidated invoicing. Enquiry-based.",
  alternates: { canonical: "https://satelink.network/corporate" },
};

const CAPABILITIES = [
  {
    icon: KeyRound,
    title: "Dedicated API keys",
    body: "Higher rate limits and consolidated credit billing across your team, on the same metered gateway.",
  },
  {
    icon: LineChart,
    title: "Custom derived metrics",
    body: "New derived statistics built on the same public-data pipeline, scoped per engagement. Public data only — never raw feed redistribution.",
  },
  {
    icon: Plug,
    title: "Integration support",
    body: "Hands-on help wiring Satelink into agent frameworks and internal research tools.",
  },
  {
    icon: Receipt,
    title: "Consolidated invoicing",
    body: "One invoice for the whole team, instead of per-seat top-ups.",
  },
];

const STEPS = [
  { n: 1, title: "Enquire", body: "Tell us what you're building and your expected volume." },
  { n: 2, title: "Scope call", body: "We agree on metrics, limits, and how you'll integrate." },
  { n: 3, title: "Pilot on credits", body: "Start on metered credits against real endpoints — no long contract to begin." },
  { n: 4, title: "Invoice", body: "Consolidated billing once the pilot proves out." },
];

export default function CorporatePage() {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-sl-border">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-28">
          <SectionHeader
            eyebrow="Corporate Services"
            title="Market data services for teams that build on them"
            lede="For funds' research desks, fintechs, exchanges, and trading-tool companies: dedicated access, custom derived metrics, and consolidated billing — on the same public-data pipeline that powers Satelink Trading Intelligence."
            align="left"
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/corporate#enquire">Discuss your requirements <ArrowRight className="size-4" /></Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/intelligence">See the data catalog</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="What you get" title="Built on the pipeline you can already inspect" align="left" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <Card key={c.title} interactive className="flex flex-col">
              <span className="mb-4 inline-flex size-11 items-center justify-center rounded-[var(--sl-radius)] bg-sl-accent-soft text-sl-accent">
                <c.icon className="size-5" />
              </span>
              <CardTitle>{c.title}</CardTitle>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-sl-text-muted">{c.body}</p>
              <Link
                href="/corporate#enquire"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong"
              >
                Discuss your requirements <ArrowRight className="size-3.5" />
              </Link>
            </Card>
          ))}
        </div>
      </section>

      {/* How an engagement works */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader eyebrow="How it works" title="From enquiry to invoice" align="left" />
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
                <span className="font-sl-mono text-sm font-bold text-sl-accent">0{s.n}</span>
                <h3 className="mt-2 font-semibold text-sl-text">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-sl-text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Who it's for + data provenance */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeader eyebrow="Who it's for" title="Teams that turn market structure into product" align="left" />
            <ul className="mt-6 space-y-3 text-sm text-sl-text-muted">
              {[
                "Research desks at funds that need derived inputs, not raw feeds",
                "Fintechs and trading-tool companies embedding market-structure data",
                "Exchanges and venues benchmarking cross-venue structure",
                "Teams running agent frameworks that call data programmatically",
              ].map((li) => (
                <li key={li} className="flex gap-2.5">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />
                  <span>{li}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-sl-text">
              <ShieldCheck className="size-4 text-sl-accent" /> Data &amp; provenance
            </div>
            <Disclosure title="Public data only — no custody, no raw redistribution">
              Every metric is derived from public market data. We do not redistribute raw exchange feeds,
              and Satelink never takes custody of funds or crypto. Modelled statistics (for example
              liquidation clusters) are labelled as models, not measurements. Nothing here is investment
              advice.
            </Disclosure>
            <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
              We don't publish standard SLAs or uptime guarantees — engagement terms are scoped on the
              call and written into your agreement, so you get commitments that match what you actually
              need.
            </p>
          </div>
        </div>
      </section>

      {/* Enquiry form */}
      <section id="enquire" className="scroll-mt-24 border-t border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader
            eyebrow="Enquire"
            title="Tell us what you're building"
            lede="We reply within 24 hours. No marketing lists — this goes straight to the team."
          />
          <div className="mt-10">
            <EnquiryForm />
          </div>
        </div>
      </section>
    </>
  );
}
