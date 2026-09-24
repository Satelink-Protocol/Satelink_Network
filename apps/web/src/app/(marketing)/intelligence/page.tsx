// /intelligence — Trading Intelligence product page. Catalog rendered from the
// live GET /v1/intelligence (ISR + static fallback). Dodo compliance: SaaS
// analytics, derived statistics from public data, not investment advice, no
// custody; x402/USDT is a separate crypto rail Dodo never processes.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCatalog } from "@/lib/intelligence";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { CodeBlock } from "@/components/ui/CodeBlock";

export const metadata: Metadata = {
  title: "Trading Intelligence",
  description:
    "Derived market analytics for machine-commerce agents: funding-rate heatmaps, open-interest shifts, liquidation clusters (modelled), and market microstructure. Free discovery, $9.99 Starter Pack, or $0.01/call via x402.",
  alternates: { canonical: "https://satelink.network/intelligence" },
};

export const revalidate = 300;

const FAQ: [string, string][] = [
  ["Is this investment advice?", "No. Every endpoint returns derived statistics computed from public market data. It is not a recommendation to trade, and Satelink never takes custody of funds."],
  ["Do you redistribute raw exchange feeds?", "No. We never redistribute a raw feed — every response is a statistic we compute from public data."],
  ["What's the difference between 'derived' and 'model'?", "Derived metrics are computed directly from public data. A model/proxy metric (liquidation clusters) estimates something not directly observable; it is labelled as a model, not a measurement."],
  ["How do I pay?", "Buy a $9.99 Starter Pack with card or UPI, or pay per call as an agent with x402 (USDC on Base) or an on-chain USDT deposit."],
  ["Is there a subscription?", "No. Purchases are one-time credit; credits never expire."],
  ["Where are the full docs?", "At docs.satelink.network — request signing, the x402 client, and the full API reference."],
];

export default async function IntelligencePage() {
  const { catalog } = await getCatalog();

  return (
    <>
      {/* Hero */}
      <section className="border-b border-sl-border">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader
            eyebrow="Trading Intelligence"
            title="Derived market analytics, priced per call"
            lede="Funding-rate heatmaps, open-interest shifts, liquidation clusters, and market microstructure — computed from public market data, never raw feeds redistributed."
            align="left"
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/checkout?plan=starter">Start with $9.99 <ArrowRight className="size-4" /></Link></Button>
            <Button asChild variant="secondary" size="lg"><a href="#try">Try free</a></Button>
          </div>
        </div>
      </section>

      {/* Try it now */}
      <section id="try" className="scroll-mt-24 mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Try it now" title="Free discovery — no signup" align="left" />
        <p className="mt-3 max-w-2xl text-sm text-sl-text-muted">
          The discovery route lists every metric, its price, and how to pay. Metered calls need a funded
          API key — the Starter Pack funds one instantly.
        </p>
        <div className="mt-6 max-w-2xl">
          <CodeBlock
            tabs={[
              { label: "curl", code: "curl https://rpc.satelink.network/v1/intelligence" },
              { label: "TS", code: 'const res = await fetch(\n  "https://rpc.satelink.network/v1/intelligence"\n);\nconst catalog = await res.json();' },
              { label: "Python", code: 'import requests\nr = requests.get("https://rpc.satelink.network/v1/intelligence")\nprint(r.json())' },
            ]}
          />
        </div>
      </section>

      {/* Catalog */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader eyebrow="Catalog" title="Four metrics, one price" align="left" lede={`$${catalog.priceModel.amount.toFixed(2)} per call.`} />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {catalog.metrics.map((m) => (
              <MetricCard key={m.slug} name={m.name} slug={m.slug} kind={m.kind} price={`$${m.priceUsd.toFixed(2)}/call`} description={m.description} isModel={m.isModel} />
            ))}
          </div>
        </div>
      </section>

      {/* Model vs derived */}
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <SectionHeader eyebrow="Read the labels" title="Derived vs. model" align="left" />
            <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
              <Badge variant="neutral" className="mr-1">derived</Badge> metrics are computed directly from
              public market data. A <Badge variant="model" className="mx-1">model</Badge> metric estimates
              something not directly observable.
            </p>
          </div>
          <Disclosure title="Liquidation clusters is a model">
            Liquidation clusters is a <strong>modelled proxy</strong> — it infers likely liquidation
            density from public price and open-interest data. It does <strong>not</strong> report real,
            measured liquidation orders. Always read the limitations on its page before relying on it.
          </Disclosure>
        </div>
      </section>

      {/* Pricing summary + API access */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Pricing" title="Free · Starter Pack · pay-per-call" align="left" />
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
              <p className="font-semibold text-sl-text">Free discovery</p>
              <p className="mt-1 text-sm text-sl-text-muted">Catalog + response shapes, rate-limited, no card.</p>
            </div>
            <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
              <p className="font-semibold text-sl-text">Starter Pack — $9.99</p>
              <p className="mt-1 text-sm text-sl-text-muted">1:1 USD credit, no expiry. Card/UPI via Dodo.</p>
            </div>
            <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
              <p className="font-semibold text-sl-text">x402 — $0.01/call</p>
              <p className="mt-1 text-sm text-sl-text-muted">Machine-to-machine. Crypto rail, not processed by Dodo.</p>
            </div>
          </div>
          <p className="mt-5 text-sm text-sl-text-muted">
            Full rate card at <Link href="/pricing" className="text-sl-accent underline">/pricing</Link>. A
            credit pack funds your API key the same way an on-chain deposit or x402 payment does — spent
            per call, same billing path as the RPC gateway. Full reference at{" "}
            <a href="https://docs.satelink.network" className="text-sl-accent underline">docs.satelink.network</a>.
          </p>
        </div>
      </section>

      {/* Compliance + FAQ */}
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <Disclosure title="What this is">
          SaaS analytics — derived statistics from public market data. Not investment advice. Satelink
          never takes custody of funds or crypto. Payments are processed by Dodo (card/UPI); x402 and
          USDT are a separate crypto rail Dodo never processes.
        </Disclosure>
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-sl-text">FAQ</h2>
          <dl className="mt-4 grid gap-5 sm:grid-cols-2">
            {FAQ.map(([q, a]) => (
              <div key={q}>
                <dt className="font-medium text-sl-text">{q}</dt>
                <dd className="mt-1 text-sm text-sl-text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
