// Home (web-v3 P2) — the claude.com pattern: short, confident, plan-led.
// hero (+ MachinePaysDemo) → quick proof strip (live stats) → three product
// tiles → Explore plans → FAQ (+ FAQPage JSON-LD) → footer (layout). The long
// platform stack moved to /product/overview. No invented numbers (§2.1): the
// proof strip is real /health data; prices are the live catalog + constants.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LineChart, CreditCard, Server, ShieldCheck, FileCode2 } from "lucide-react";
import { buildMetadata, faqLd, jsonLdScript } from "@satelink/seo";
import { MachinePaysDemo, ScrollReveal, Stagger, StaggerItem } from "@satelink/web-ui";
import { getCatalog } from "@/lib/intelligence";
import { FLAT_RATE_USD } from "@/lib/products";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Disclosure } from "@/components/ui/Disclosure";
import { LiveNetworkStrip } from "@/components/site/LiveNetworkStrip";
import { ExplorePlans } from "@/components/ExplorePlans";

export const metadata: Metadata = buildMetadata({
  title: "Commerce for software that pays software",
  description:
    "Satelink is machine commerce infrastructure: a software agent discovers a priced API, pays for it without a human, calls it, and settles on-chain — on Polygon, with x402, USDT, or prepaid credits.",
  path: "/",
});

export const revalidate = 300;

const VAULT_URL = "https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF";
const X402_KIT_URL = "https://github.com/Satelink-Protocol/x402-kit";

const TILES = [
  {
    name: "Trading Intelligence",
    href: "/products/trading-intelligence",
    icon: LineChart,
    color: "market" as const,
    line: "Derived market analytics — funding, open interest, microstructure — bought per call.",
  },
  {
    name: "Machine Payments (x402)",
    href: "/products/x402",
    icon: CreditCard,
    color: "machine" as const,
    line: "HTTP-native, keyless payments in USDC on Base. An agent pays a 402 on its own.",
  },
  {
    name: "RPC",
    href: "/products/rpc",
    icon: Server,
    color: "settle" as const,
    line: "Metered Polygon JSON-RPC at a flat per-call rate. No seat licence, no commitment.",
  },
];

const COLOR_CLASS: Record<"market" | "machine" | "settle", { text: string; soft: string }> = {
  market: { text: "text-sl-market", soft: "bg-sl-market-soft" },
  machine: { text: "text-sl-machine", soft: "bg-sl-machine-soft" },
  settle: { text: "text-sl-settle", soft: "bg-sl-settle-soft" },
};

const FAQ = [
  {
    question: "What is Satelink?",
    answer:
      "Machine-commerce infrastructure: the rails a software agent uses to discover a priced API, pay for it without a human, call it, and settle the payment on-chain on Polygon.",
  },
  {
    question: "What is machine commerce?",
    answer:
      "Humans buy products at a checkout; software increasingly buys services — an RPC call, a market-data query — thousands of times an hour. Machine commerce is the discovery, pricing, payment, and settlement that traffic needs.",
  },
  {
    question: "What can I buy?",
    answer:
      "Derived Trading Intelligence (funding-rate heatmaps, open-interest shifts, market microstructure, liquidation clusters) and metered Polygon RPC — priced per call, discoverable as public JSON.",
  },
  {
    question: "How does a machine pay?",
    answer:
      "The service quotes a price in a signed HTTP 402 response. The agent pays with x402 (USDC on Base), a USDT deposit, or a prepaid credit balance — and receives a verifiable on-chain receipt.",
  },
  {
    question: "How much does it cost?",
    answer:
      "Trading Intelligence is $0.01 per call and Polygon RPC is $0.00003 per call. Individuals can start Free (300 calls/month) or buy a credit pack from $9.99; there is no subscription required.",
  },
  {
    question: "Is this investment advice?",
    answer: "No. Satelink sells derived analytics computed from public market data. It is not investment advice and Satelink never takes custody of funds.",
  },
];

export default async function HomePage() {
  const { catalog } = await getCatalog();
  const tiPrice = catalog.metrics[0]?.priceUsd ?? 0.01;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqLd(FAQ)) }} />

      {/* Hero — gradient band */}
      <section className="relative overflow-hidden border-b border-sl-border">
        <div className="sl-grad-hero pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">
              Machine commerce infrastructure
            </p>
            <h1 className="font-sl-display text-balance font-extrabold leading-[1.05] tracking-[-0.02em] text-sl-text" style={{ fontSize: "var(--sl-display-1)" }}>
              Commerce for software that pays software.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-sl-text-muted">
              Discover a priced API, pay for it without a human, and settle on-chain — on Polygon,
              with x402, USDT, or prepaid credits.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/signup">Start free <ArrowRight className="size-4" /></Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/product/overview#lifecycle">See how machines pay</Link>
              </Button>
            </div>
          </div>
          <MachinePaysDemo />
        </div>
      </section>

      {/* Quick proof strip — live stats only */}
      <section className="border-b border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
          <LiveNetworkStrip />
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-sl-text-muted">
            <span>Signals from the public gateway health probe.</span>
            <a href={VAULT_URL} className="inline-flex items-center gap-1.5 font-semibold text-sl-settle hover:underline">
              <ShieldCheck className="size-3.5" /> RevenueVault V2 on Polygon
            </a>
            <a href={X402_KIT_URL} className="inline-flex items-center gap-1.5 font-semibold text-sl-machine hover:underline">
              <FileCode2 className="size-3.5" /> x402-kit (open source)
            </a>
          </p>
        </div>
      </section>

      {/* Three product tiles */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="Products" title="Three ways to build on the rail" />
        <Stagger className="mt-10 grid gap-4 md:grid-cols-3">
          {TILES.map((t) => {
            const c = COLOR_CLASS[t.color];
            return (
              <StaggerItem key={t.name}>
                <Card interactive className="flex h-full flex-col">
                  <span className={`mb-4 inline-flex size-11 items-center justify-center rounded-[var(--sl-radius)] ${c.soft} ${c.text}`}>
                    <t.icon className="size-5" />
                  </span>
                  <h3 className={`font-semibold ${c.text}`}>{t.name}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-sl-text-muted">{t.line}</p>
                  <Link href={t.href} className={`mt-4 inline-flex items-center gap-1.5 text-sm font-semibold ${c.text} hover:underline`}>
                    Learn more <ArrowRight className="size-3.5" />
                  </Link>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      </section>

      {/* Explore plans */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader
            eyebrow="Plans"
            title="Explore plans"
            lede="Start Free, upgrade when you need more, or pay per call as an agent. Trading Intelligence is $0.01/call; RPC is $0.00003/call."
          />
          <div className="mt-10">
            <ScrollReveal>
              <ExplorePlans />
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-[820px] px-4 py-20 sm:px-6">
        <SectionHeader title="Frequently asked" align="left" />
        <div className="mt-8 space-y-3">
          {FAQ.map((f) => (
            <Disclosure key={f.question} title={f.question}>
              {f.answer}
            </Disclosure>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface px-6 py-14 text-center">
          <Badge variant="live" dot className="mx-auto">Live on Polygon</Badge>
          <h2 className="mx-auto mt-4 max-w-xl text-balance font-sl-display text-3xl font-extrabold tracking-[-0.02em] text-sl-text sm:text-4xl">
            Build for the machine economy.
          </h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg"><Link href="/signup">Start free</Link></Button>
            <Button asChild variant="secondary" size="lg"><Link href="/product/overview">Explore the platform</Link></Button>
          </div>
          <p className="mt-4 text-xs text-sl-text-subtle">
            Trading Intelligence from ${tiPrice}/call · RPC ${FLAT_RATE_USD}/call · no subscription required.
          </p>
        </div>
      </section>
    </>
  );
}
