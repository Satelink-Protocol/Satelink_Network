// Home — machine-commerce positioning (§3/§6). Trading Intelligence and
// Corporate Services are the two commercial lines; the machine rail (x402/RPC)
// is supporting, not the headline. Catalog rendered from the live
// /v1/intelligence at build/ISR time with a static fallback. No invented
// numbers (§2.1): the live strip is real /health data, proof links are factual.
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  CreditCard,
  Radar,
  Building2,
  LineChart,
  ShieldCheck,
  FileCode2,
} from "lucide-react";
import { getCatalog } from "@/lib/intelligence";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Disclosure } from "@/components/ui/Disclosure";
import { TerminalWindow } from "@/components/ui/TerminalWindow";
import { LiveNetworkStrip } from "@/components/site/LiveNetworkStrip";

export const metadata: Metadata = {
  title: "Market intelligence that machines can buy",
  description:
    "Satelink is machine commerce infrastructure: derived market intelligence and metered data services that software agents and companies can buy, call, and settle automatically. Start with a $9.99 Starter Pack or pay per call.",
  alternates: { canonical: "https://satelink.network" },
};

export const revalidate = 300;

const CURL_RESPONSE = `$ curl https://rpc.satelink.network/v1/intelligence

{
  "service": "Satelink Trading Intelligence",
  "pricing_model": "pay_per_call_credits",
  "currency": "USDT",
  "metrics": [
    { "metric": "funding-rate-heatmap", "price_usdt": 0.01, "kind": "derived" },
    { "metric": "open-interest-shifts", "price_usdt": 0.01, "kind": "derived" },
    { "metric": "liquidation-clusters", "price_usdt": 0.01, "kind": "derived" },
    { "metric": "market-microstructure", "price_usdt": 0.01, "kind": "derived" }
  ]
}`;

const STEPS = [
  { icon: Radar, title: "Discover", body: "Agents read the JSON catalog and pricing — no signup, no key required." },
  { icon: CreditCard, title: "Pay", body: "Buy a credit pack (card/UPI), or pay per call with x402 (USDC on Base) / USDT." },
  { icon: Boxes, title: "Call & settle", body: "Call the metered endpoint; settlement is automatic and on-chain-verifiable." },
];

export default async function HomePage() {
  const { catalog } = await getCatalog();

  return (
    <>
      {/* Hero */}
      <section className="border-b border-sl-border">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">
              Machine commerce infrastructure
            </p>
            <h1 className="text-balance text-[2.5rem] font-bold leading-[1.08] tracking-[-0.02em] text-sl-text sm:text-[3.25rem]">
              Market intelligence that machines can buy.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-sl-text-muted">
              Derived funding-rate, open-interest, and microstructure analytics that agents and teams
              buy per call — discover, pay, and settle automatically.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/checkout?plan=starter">Start with $9.99 <ArrowRight className="size-4" /></Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/intelligence#try">Try free — no signup</Link>
              </Button>
            </div>
          </div>
          <TerminalWindow title="rpc.satelink.network/v1/intelligence" className="shadow-[var(--sl-shadow-2)]">
            <pre className="whitespace-pre-wrap break-words text-sl-text-muted">
              <span className="text-sl-accent">{CURL_RESPONSE.split("\n\n")[0]}</span>
              {"\n\n"}
              {CURL_RESPONSE.split("\n\n")[1]}
            </pre>
          </TerminalWindow>
        </div>
      </section>

      {/* Two commercial lines */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="Two lines, one platform" title="Buy the data, or build on it with us" />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Card interactive className="flex flex-col">
            <span className="mb-4 inline-flex size-11 items-center justify-center rounded-[var(--sl-radius)] bg-sl-accent-soft text-sl-accent">
              <LineChart className="size-5" />
            </span>
            <CardTitle>Trading Intelligence</CardTitle>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-sl-text-muted">
              Derived market analytics for quant devs, agent builders, and research teams. Free
              discovery → $9.99 Starter Pack → pay-per-call.
            </p>
            <Link href="/intelligence" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
              Explore the catalog <ArrowRight className="size-3.5" />
            </Link>
          </Card>
          <Card interactive className="flex flex-col">
            <span className="mb-4 inline-flex size-11 items-center justify-center rounded-[var(--sl-radius)] bg-sl-accent-soft text-sl-accent">
              <Building2 className="size-5" />
            </span>
            <CardTitle>Corporate Services</CardTitle>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-sl-text-muted">
              Dedicated keys, custom derived metrics, integration support, and consolidated invoicing
              for funds, fintechs, exchanges, and trading-tool companies.
            </p>
            <Link href="/corporate#enquire" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
              Discuss your requirements <ArrowRight className="size-3.5" />
            </Link>
          </Card>
        </div>
      </section>

      {/* Catalog strip */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader eyebrow="The catalog" title="Four derived metrics, $0.01 per call" align="left" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {catalog.metrics.map((m) => (
              <MetricCard
                key={m.slug}
                name={m.name}
                slug={m.slug}
                kind={m.kind}
                price={`$${m.priceUsd.toFixed(2)}/call`}
                description={m.description}
                isModel={m.isModel}
              />
            ))}
          </div>
        </div>
      </section>

      {/* How machines buy */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="How machines buy" title="Discover · Pay · Call &amp; settle" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-10 items-center justify-center rounded-[var(--sl-radius)] bg-sl-accent-soft text-sl-accent">
                  <s.icon className="size-5" />
                </span>
                <span className="font-sl-mono text-sm text-sl-text-subtle">0{i + 1}</span>
              </div>
              <h3 className="mt-4 font-semibold text-sl-text">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-sl-text-muted">{s.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-sl-text-muted">
          Discovery is public JSON at{" "}
          <a href="https://rpc.satelink.network/.well-known/satelink.json" className="font-sl-mono text-sl-accent underline">
            /.well-known/satelink.json
          </a>
          . <Link href="/machine" className="text-sl-accent underline">For agents →</Link>
        </p>
      </section>

      {/* Live network */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader eyebrow="Live network" title="Running now" align="left" lede="Signals from the public gateway health probe. Full metrics on the status page." />
          <div className="mt-8">
            <LiveNetworkStrip />
          </div>
          <p className="mt-4 text-sm text-sl-text-muted">
            <Link href="/status" className="text-sl-accent underline">See full status →</Link>
          </p>
        </div>
      </section>

      {/* Proof */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="Proof" title="On-chain and open source" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Card>
            <ShieldCheck className="size-5 text-sl-accent" />
            <CardTitle className="mt-4 text-base">RevenueVault V2</CardTitle>
            <p className="mt-2 text-sm text-sl-text-muted">Settlement vault on Polygon (chain 137).</p>
            <a
              href="https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong"
            >
              View on Polygonscan <ArrowRight className="size-3.5" />
            </a>
          </Card>
          <Card>
            <Boxes className="size-5 text-sl-accent" />
            <CardTitle className="mt-4 text-base">First on-chain claim</CardTitle>
            <p className="mt-2 text-sm text-sl-text-muted">A settled claim transaction, verifiable on-chain.</p>
            <a
              href="https://polygonscan.com/tx/0x814d348d3f6cb4164d2aadf99b574d4ca65221d2155a76b0e99a4e8641a1726b"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong"
            >
              View transaction <ArrowRight className="size-3.5" />
            </a>
          </Card>
          <Card>
            <FileCode2 className="size-5 text-sl-accent" />
            <CardTitle className="mt-4 text-base">x402-kit</CardTitle>
            <p className="mt-2 text-sm text-sl-text-muted">Open-source x402 payment toolkit (MIT).</p>
            <a
              href="https://github.com/Satelink-Protocol/x402-kit"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong"
            >
              View on GitHub <ArrowRight className="size-3.5" />
            </a>
          </Card>
        </div>
      </section>

      {/* Compliance band */}
      <section className="mx-auto max-w-[1200px] px-4 pb-8 sm:px-6">
        <Disclosure title="What this is">
          Satelink Trading Intelligence is a SaaS analytics product — derived statistics from public
          market data. It is <strong>not investment advice</strong>, and Satelink never takes custody of
          funds. Payments for it are processed by Dodo (card/UPI); x402 and USDT are a separate crypto
          rail Dodo never processes.
        </Disclosure>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface px-6 py-14 text-center">
          <Badge variant="live" dot className="mx-auto">Live on Polygon</Badge>
          <h2 className="mx-auto mt-4 max-w-xl text-balance text-[1.75rem] font-bold tracking-[-0.02em] text-sl-text sm:text-[2.25rem]">
            Start with $9.99 of API credit.
          </h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/checkout?plan=starter">Get started</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/intelligence#try">Try free first</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
