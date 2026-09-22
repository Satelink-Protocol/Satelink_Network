// /product/overview (§8) — platform-wide overview + the interactive selector.
// Order: H1 → 3 value cards → "Put Satelink to work" (real tasks + code) →
// principles → capability grid → interactive selector → FAQs → CTA. Live TI
// price comes from the catalog; every other number is a documented constant.
import type { Metadata } from "next";
import Link from "next/link";
import { Radar, CreditCard, ReceiptText } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { getCatalog } from "@/lib/intelligence";
import { PRODUCTS, FLAT_RATE_USD, X402_BUNDLE } from "@/lib/products";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { CodeBlock } from "@/components/ui/CodeBlock";
import {
  InteractiveSelector,
  type SelectorProduct,
  type SelectorRole,
  type SelectorNeed,
} from "@/components/InteractiveSelector";

export const metadata: Metadata = buildMetadata({
  title: "Platform overview",
  description:
    "One platform for machine commerce: discover a priced API, pay per use with x402, USDT, or credits, and settle on-chain. See what to build, then use the selector to find the right product.",
  path: "/product/overview",
});

export const revalidate = 300;

const VALUE = [
  { icon: Radar, title: "Discover", body: "Every service publishes a machine-readable catalog and price. Agents find and evaluate it with no signup." },
  { icon: CreditCard, title: "Pay per use", body: "No seats, no subscription. A 402 quotes the price and the machine pays with x402, USDT, or a prepaid balance." },
  { icon: ReceiptText, title: "Settle transparently", body: "Revenue aggregates per epoch and settles on-chain to a Polygon vault anyone can verify." },
];

const PRINCIPLES = [
  "Discovery and pricing are public before any authentication.",
  "Price is quoted by the service in a signed 402 — never assumed by the caller.",
  "Billing is per completed call at a flat, published rate.",
  "Spend is bounded by a prepaid balance and per-key limits.",
  "Every settled call produces an on-chain-verifiable receipt.",
  "The x402 rail is keyless; the credit rail is per-account.",
];

const CAPABILITIES = [
  { title: "Public discovery", body: "/.well-known/satelink.json + the /v1/intelligence catalog." },
  { title: "402 payment flow", body: "HTTP 402 with machine-readable payment requirements." },
  { title: "Keyless x402", body: "Pay in USDC on Base with no account." },
  { title: "Prepaid credits", body: "USDT deposit drawn down per call." },
  { title: "Per-call metering", body: "Flat-rate accounting attributed per key." },
  { title: "On-chain settlement", body: "Per-epoch aggregation to RevenueVaultV2 on Polygon." },
];

const ROLES: SelectorRole[] = [
  { id: "trading-agent", label: "a trading agent" },
  { id: "ai-agent", label: "an AI agent" },
  { id: "api-product", label: "an API product" },
  { id: "enterprise-app", label: "an enterprise app" },
];

const NEEDS: SelectorNeed[] = [
  { id: "market-data", label: "market data", product: "trading-intelligence" },
  { id: "rpc-access", label: "RPC access", product: "rpc" },
  { id: "charge-per-call", label: "to charge per call", product: "metering" },
  { id: "machine-payments", label: "machine payments", product: "x402" },
];

export default async function OverviewPage() {
  const { catalog } = await getCatalog();
  const tiPrice = catalog.metrics[0]?.priceUsd ?? 0.01;

  // Live price lines fed into the selector (no hardcoded catalog numbers).
  const priceLines: Record<string, string> = {
    "trading-intelligence": `$${tiPrice} per call`,
    rpc: `$${FLAT_RATE_USD} per call · $${X402_BUNDLE.priceUsd} = ${X402_BUNDLE.calls.toLocaleString()} calls`,
    metering: `$${FLAT_RATE_USD} per call from a prepaid balance`,
    x402: `USDC on Base · $${X402_BUNDLE.priceUsd} = ${X402_BUNDLE.calls.toLocaleString()} calls`,
  };

  const selectorProducts: Record<string, SelectorProduct> = Object.fromEntries(
    (["trading-intelligence", "rpc", "metering", "x402"] as const).map((slug) => {
      const p = PRODUCTS[slug];
      return [slug, { slug, name: p.name, href: p.href, priceLine: priceLines[slug], exampleRequest: p.exampleRequest, docs: p.docs }];
    })
  );

  const TASKS = [
    {
      title: "Read a derived market metric",
      body: "An agent buys one funding-rate reading per decision.",
      code: `curl ${catalog.metrics[0] ? "https://rpc.satelink.network/v1/intelligence/" + catalog.metrics[0].slug : "https://rpc.satelink.network/v1/intelligence"}`,
    },
    {
      title: "Make a Polygon RPC call",
      body: "A bot reads chain state at the flat per-call rate.",
      code: PRODUCTS.rpc.exampleRequest,
    },
    {
      title: "Pay keylessly with x402",
      body: "No account — the price arrives in a 402 and the machine pays.",
      code: PRODUCTS.x402.exampleRequest,
    },
  ];

  return (
    <>
      <section className="mx-auto max-w-[1100px] px-4 pt-16 text-center sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Platform overview</p>
        <h1 className="mx-auto mt-3 max-w-[22ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">
          One platform for software that pays software.
        </h1>
        <p className="mx-auto mt-5 max-w-[60ch] text-lg text-sl-text-muted">
          Discover a priced API, pay per use, and settle on-chain. Below: the three things every
          Satelink product does, what you can build today, and a selector to find your product.
        </p>
      </section>

      {/* Value cards */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="grid gap-5 sm:grid-cols-3">
          {VALUE.map((v) => (
            <Card key={v.title}>
              <span className="mb-4 inline-flex size-11 items-center justify-center rounded-[var(--sl-radius)] bg-sl-accent-soft text-sl-accent">
                <v.icon className="size-5" />
              </span>
              <CardTitle>{v.title}</CardTitle>
              <CardDescription>{v.body}</CardDescription>
            </Card>
          ))}
        </div>
      </section>

      {/* Put Satelink to work */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Put Satelink to work" title="Three things you can build today" align="left" />
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {TASKS.map((t) => (
              <div key={t.title} className="flex flex-col rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
                <h3 className="font-semibold text-sl-text">{t.title}</h3>
                <p className="mt-1.5 flex-1 text-sm text-sl-text-muted">{t.body}</p>
                <CodeBlock code={t.code} ariaLabel={t.title} className="mt-4" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Principles" title="The rules the rail runs on" align="left" />
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <li key={p} className="flex items-start gap-2.5 rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4 text-sm text-sl-text-muted">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sl-accent" />
              {p}
            </li>
          ))}
        </ul>
      </section>

      {/* Capability grid */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Capabilities" title="What the platform provides" align="left" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
                <p className="font-semibold text-sl-text">{c.title}</p>
                <p className="mt-1.5 text-sm text-sl-text-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive selector */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Find your product" title="Tell us what you're building" />
        <div className="mt-8">
          <InteractiveSelector roles={ROLES} needs={NEEDS} products={selectorProducts} />
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-[820px] px-4 py-8 sm:px-6">
        <SectionHeader title="Questions" align="left" />
        <div className="mt-6 space-y-3">
          <Disclosure title="Do I need an account to start?">
            No. Discovery and pricing are public JSON. You need a key or an x402 wallet only when you
            make a paid call.
          </Disclosure>
          <Disclosure title="How is a price decided?">
            The service quotes it in a signed HTTP 402 response. The caller reads the requirements and
            pays exactly what is asked — nothing is assumed client-side.
          </Disclosure>
          <Disclosure title="Where does the money settle?">
            Per-call revenue aggregates per epoch and settles on-chain to RevenueVaultV2 on Polygon
            (chain 137), which anyone can verify on Polygonscan.
          </Disclosure>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface px-6 py-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-sl-text">Ready to build?</h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg"><Link href="/developers/quickstart">Start building</Link></Button>
            <Button asChild variant="secondary" size="lg"><Link href="/pricing">See pricing</Link></Button>
          </div>
        </div>
      </section>
    </>
  );
}
