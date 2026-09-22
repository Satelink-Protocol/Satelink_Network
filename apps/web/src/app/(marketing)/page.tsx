// Home — machine-commerce IA (§8). Positioning is the platform, not one product:
// hero → live network → "what is machine commerce?" entity → lifecycle stepper
// (SSR) → products grid (5) → how it works → audiences → on-chain proof → live
// pricing summary → resources → final CTA. No invented numbers (§2.1): the live
// strip is real /health data, the pricing summary is the live catalog, proof
// links are on-chain facts.
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  CreditCard,
  LineChart,
  Server,
  Gauge,
  Radar,
  Plug,
  Cpu,
  ReceiptText,
  ShieldCheck,
  FileCode2,
  Code2,
  Bot,
  Building2,
} from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { LifecycleStepper } from "@satelink/web-ui";
import { getCatalog } from "@/lib/intelligence";
import { PRODUCTS, PRODUCT_ORDER, FLAT_RATE_USD, type ProductSlug } from "@/lib/products";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { TerminalWindow } from "@/components/ui/TerminalWindow";
import { LiveNetworkStrip } from "@/components/site/LiveNetworkStrip";

export const metadata: Metadata = buildMetadata({
  title: "Machine Commerce Infrastructure",
  description:
    "Satelink is machine commerce infrastructure: the rails a software agent uses to discover a priced API, pay for it without a human, call it, and settle the payment on-chain — on Polygon, with x402, USDT, or prepaid credits.",
  path: "/",
});

export const revalidate = 300;

const PRODUCT_ICONS: Record<ProductSlug, typeof Boxes> = {
  "machine-commerce": Boxes,
  "trading-intelligence": LineChart,
  rpc: Server,
  x402: CreditCard,
  metering: Gauge,
};

const HOW_IT_WORKS = [
  { icon: Radar, title: "Discover", body: "Agents read the public JSON catalog and machine-readable pricing — no signup." },
  { icon: Plug, title: "Connect", body: "Authenticate with an API key, or stay keyless with an x402 wallet." },
  { icon: CreditCard, title: "Pay", body: "A 402 quotes the price; pay with x402 (USDC on Base), USDT, or prepaid credits." },
  { icon: Cpu, title: "Execute", body: "The gateway runs the RPC or intelligence query and returns the result." },
  { icon: Gauge, title: "Meter", body: "Every call is counted at the flat per-call rate and drawn from the balance." },
  { icon: ReceiptText, title: "Settle", body: "Revenue aggregates per epoch and settles on-chain to a verifiable Polygon vault." },
];

const AUDIENCES = [
  {
    icon: Code2,
    title: "For developers",
    body: "A REST API, keyless x402, and the MIT x402-kit. Pay per call, no seat licence, no commitment.",
    href: "/developers/quickstart",
    cta: "Start building",
  },
  {
    icon: Bot,
    title: "For AI agents",
    body: "Public discovery, machine-readable pricing, and a 402 flow an autonomous buyer can complete on its own.",
    href: "/products/machine-commerce",
    cta: "How a machine pays",
  },
  {
    icon: Building2,
    title: "For enterprise",
    body: "Dedicated keys, spend controls, usage attribution, and transparent on-chain settlement.",
    href: "/solutions/enterprise",
    cta: "Talk to Satelink",
  },
];

const PROOF = [
  {
    icon: ShieldCheck,
    title: "RevenueVaultV2",
    body: "Settlement vault on Polygon (chain 137).",
    href: "https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF",
    cta: "View on Polygonscan",
  },
  {
    icon: Boxes,
    title: "First on-chain claim",
    body: "A settled claim transaction, verifiable on-chain.",
    href: "https://polygonscan.com/tx/0x814d348d3f6cb4164d2aadf99b574d4ca65221d2155a76b0e99a4e8641a1726b",
    cta: "View transaction",
  },
  {
    icon: FileCode2,
    title: "x402-kit",
    body: "Open-source x402 payment toolkit (MIT).",
    href: "https://github.com/Satelink-Protocol/x402-kit",
    cta: "View on GitHub",
  },
];

const RESOURCES = [
  { title: "Documentation", body: "API reference, quickstarts, and the 402 flow.", href: "https://docs.satelink.network" },
  { title: "Platform overview", body: "Every capability, mapped to the console.", href: "/platform/api" },
  { title: "Pricing", body: "Live rates, a usage calculator, and pricing.json.", href: "/pricing" },
];

export default async function HomePage() {
  const { catalog } = await getCatalog();
  const tiPrice = catalog.metrics[0]?.priceUsd ?? 0.01;

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
              Infrastructure for software that pays software.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-sl-text-muted">
              Satelink is the rail a machine uses to discover a priced API, pay for it without a
              human, call it, and settle the payment on-chain — on Polygon, with x402, USDT, or
              prepaid credits.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/developers/quickstart">Start building <ArrowRight className="size-4" /></Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/products/machine-commerce">Explore Machine Commerce</Link>
              </Button>
            </div>
          </div>
          <TerminalWindow title="rpc.satelink.network/.well-known/satelink.json" className="shadow-[var(--sl-shadow-2)]">
            <pre className="whitespace-pre-wrap break-words text-sl-text-muted">
              <span className="text-sl-accent">$ curl https://rpc.satelink.network/.well-known/satelink.json</span>
              {"\n\n"}
              {`{
  "services": ["/v1/intelligence", "/rpc/polygon"],
  "pricing": "https://satelink.network/pricing.json",
  "payments": ["x402", "usdt", "credits"]
}`}
            </pre>
          </TerminalWindow>
        </div>
      </section>

      {/* Live network */}
      <section className="border-b border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
          <LiveNetworkStrip />
          <p className="mt-4 text-sm text-sl-text-muted">
            Signals from the public gateway health probe.{" "}
            <Link href="/status" className="text-sl-accent underline">Full status →</Link>
          </p>
        </div>
      </section>

      {/* What is machine commerce? — GEO entity block */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Definition</p>
            <h2 className="mt-3 text-balance text-[1.75rem] font-bold tracking-[-0.02em] text-sl-text sm:text-[2.25rem]">
              What is machine commerce?
            </h2>
          </div>
          <div>
            <p className="text-lg leading-relaxed text-sl-text-muted">
              {PRODUCTS["machine-commerce"].definition}
            </p>
            <p className="mt-4 text-sm text-sl-text-muted">
              Humans buy products at a checkout. Software increasingly buys <em>services</em> — an
              RPC call, a market-data query — thousands of times an hour. Satelink gives that traffic
              a way to pay.{" "}
              <Link href="/products/machine-commerce" className="text-sl-accent underline">
                Read the full explanation →
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* Lifecycle stepper (SSR) */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
          <SectionHeader eyebrow="How a machine pays" title="One request, end to end" align="left" />
          <LifecycleStepper />
        </div>
      </section>

      {/* Products grid (5) */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="Products" title="Five ways to build on the rail" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCT_ORDER.map((slug) => {
            const p = PRODUCTS[slug];
            const Icon = PRODUCT_ICONS[slug];
            return (
              <Card key={slug} interactive className="flex flex-col">
                <span className="mb-4 inline-flex size-11 items-center justify-center rounded-[var(--sl-radius)] bg-sl-accent-soft text-sl-accent">
                  <Icon className="size-5" />
                </span>
                <CardTitle>{p.name}</CardTitle>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-sl-text-muted">{p.tagline}</p>
                <Link href={p.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
                  Learn more <ArrowRight className="size-3.5" />
                </Link>
              </Card>
            );
          })}
          <Card className="flex flex-col justify-center bg-sl-bg-raised">
            <p className="text-sm leading-relaxed text-sl-text-muted">
              Not sure which fits? Answer two questions on the overview and we&rsquo;ll point you at
              the right product, a real request, and its live price.
            </p>
            <Link href="/product/overview" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
              Platform overview <ArrowRight className="size-3.5" />
            </Link>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader eyebrow="How it works" title="Discover · Connect · Pay · Execute · Meter · Settle" align="left" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {HOW_IT_WORKS.map((s, i) => (
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
        </div>
      </section>

      {/* Audiences */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="Built for" title="Developers, agents, and enterprises" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <Card key={a.title} className="flex flex-col">
              <span className="mb-4 inline-flex size-11 items-center justify-center rounded-[var(--sl-radius)] bg-sl-accent-soft text-sl-accent">
                <a.icon className="size-5" />
              </span>
              <CardTitle>{a.title}</CardTitle>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-sl-text-muted">{a.body}</p>
              <Link href={a.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
                {a.cta} <ArrowRight className="size-3.5" />
              </Link>
            </Card>
          ))}
        </div>
      </section>

      {/* On-chain proof */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader eyebrow="Proof" title="On-chain and open source" align="left" />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PROOF.map((c) => (
              <Card key={c.title}>
                <c.icon className="size-5 text-sl-accent" />
                <CardTitle className="mt-4 text-base">{c.title}</CardTitle>
                <p className="mt-2 text-sm text-sl-text-muted">{c.body}</p>
                <a href={c.href} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
                  {c.cta} <ArrowRight className="size-3.5" />
                </a>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing summary (live) */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="Pricing" title="Pay for what a machine actually uses" />
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <Card>
            <CardTitle className="text-base">RPC & machine commerce</CardTitle>
            <p className="mt-2 font-sl-mono text-2xl font-bold tabular-nums text-sl-text">${FLAT_RATE_USD}</p>
            <p className="mt-1 text-sm text-sl-text-muted">per call, flat.</p>
          </Card>
          <Card>
            <CardTitle className="text-base">Trading Intelligence</CardTitle>
            <p className="mt-2 font-sl-mono text-2xl font-bold tabular-nums text-sl-text">${tiPrice}</p>
            <p className="mt-1 text-sm text-sl-text-muted">per call · from the live catalog.</p>
          </Card>
          <Card>
            <CardTitle className="text-base">Enterprise</CardTitle>
            <p className="mt-2 text-2xl font-bold text-sl-text">Contact sales</p>
            <p className="mt-1 text-sm text-sl-text-muted">Dedicated keys and invoicing.</p>
          </Card>
        </div>
        <p className="mt-6 text-sm text-sl-text-muted">
          <Link href="/pricing" className="text-sl-accent underline">See full pricing →</Link>
          {"  ·  "}
          <a href="https://satelink.network/pricing.json" className="font-sl-mono text-sl-accent underline">pricing.json</a>
        </p>
      </section>

      {/* Resources */}
      <section className="border-t border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Resources" title="Where to go next" align="left" />
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {RESOURCES.map((r) => (
              <Link key={r.title} href={r.href} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 transition-colors hover:border-sl-accent">
                <p className="font-semibold text-sl-text">{r.title}</p>
                <p className="mt-1.5 text-sm text-sl-text-muted">{r.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface px-6 py-14 text-center">
          <Badge variant="live" dot className="mx-auto">Live on Polygon</Badge>
          <h2 className="mx-auto mt-4 max-w-xl text-balance text-[1.75rem] font-bold tracking-[-0.02em] text-sl-text sm:text-[2.25rem]">
            Build for the machine economy.
          </h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/developers/quickstart">Start building</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/product/overview">Explore the platform</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
