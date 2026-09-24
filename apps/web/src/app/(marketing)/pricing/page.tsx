// /pricing (§8) — audience switch · product selector · price cards · usage
// calculator (live) · compare table · live rate card · credits explainer
// (shared-balance, disclosed) · x402 explainer · pricing.json · grouped FAQ.
// The Dodo-billed Starter Pack (Trading Intelligence only) is kept explicitly
// separate from the crypto rail (x402/USDT), which Dodo never processes (§2.2).
// No recurring subscription while the backend is one-time only.
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@satelink/seo";
import { getCatalog } from "@/lib/intelligence";
import { FLAT_RATE_USD, X402_BUNDLE, STARTER_PACK_USD } from "@/lib/products";
import { PriceCard } from "@/components/ui/PriceCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Disclosure } from "@/components/ui/Disclosure";
import { ComparisonTable } from "@/components/ui/ComparisonTable";
import { AudienceSwitch, UsageCalculator, type Audience } from "@/components/PricingTools";

export const metadata: Metadata = buildMetadata({
  title: "Pricing",
  description:
    "Satelink pricing: free discovery, a $9.99 one-time Starter Pack (card/UPI via Dodo, Trading Intelligence only), pay-per-call via x402/USDT ($0.01 intelligence · $0.00003 RPC), and Enterprise. No subscription.",
  path: "/pricing",
});

export const revalidate = 300;

const AUDIENCES: Audience[] = [
  { id: "humans", label: "Humans", headline: "Buy a Starter Pack and start calling", body: `A one-time $${STARTER_PACK_USD} Starter Pack (card or UPI) funds a balance you spend per call on Trading Intelligence. No subscription, nothing to cancel.`, cta: { label: "Get the Starter Pack", href: "/checkout?plan=starter" } },
  { id: "developers", label: "Developers", headline: "Pay per call, no seat licence", body: "Fund a balance with USDT or buy an x402 bundle, then call the API at a flat per-call rate. Test with free discovery first — no signup.", cta: { label: "Read the quickstart", href: "/developers/quickstart" } },
  { id: "machines", label: "Machines & agents", headline: "Keyless x402 — pay in the request", body: `An agent reads the price from a 402 response and pays in USDC on Base with no account. One bundle is $${X402_BUNDLE.priceUsd} for ${X402_BUNDLE.calls.toLocaleString()} RPC calls.`, cta: { label: "How a machine pays", href: "/products/machine-commerce" } },
  { id: "enterprise", label: "Enterprise", headline: "Dedicated keys and one invoice", body: "Higher limits, per-key attribution, spend controls, and consolidated invoicing through a corporate engagement.", cta: { label: "Talk to Satelink", href: "/contact-sales" } },
];

export default async function PricingPage() {
  const { catalog } = await getCatalog();
  const tiPrice = catalog.metrics[0]?.priceUsd ?? 0.01;

  const calcProducts = [
    { id: "ti", label: "Trading Intelligence", unitPrice: tiPrice },
    { id: "rpc", label: "RPC", unitPrice: FLAT_RATE_USD },
  ];

  const compareColumns = ["", "Free", `Starter Pack`, "Pay-per-call", "Enterprise"];
  const compareRows = [
    { label: "Account required", cells: [false, true, false, true] },
    { label: "Payment", cells: ["None", "Card / UPI (Dodo)", "x402 / USDT", "Invoice"] },
    { label: "Commitment", cells: ["None", "One-time", "None", "Contract"] },
    { label: "Best for", cells: ["Evaluating", "Getting started", "Agents & scale", "Teams"] },
    { label: "Rate limits", cells: ["Daily cap", "Standard", "Standard", "Higher"] },
  ];

  return (
    <>
      <section className="border-b border-sl-border">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 md:py-20">
          <SectionHeader
            eyebrow="Pricing"
            title="Pay for what a machine calls."
            lede="Free discovery, a one-time Starter Pack, or pay per call on the crypto rail. No subscription while billing is one-time only."
          />
        </div>
      </section>

      {/* Audience switch */}
      <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
        <SectionHeader eyebrow="By audience" title="Find your path" align="left" />
        <div className="mt-8">
          <AudienceSwitch audiences={AUDIENCES} />
        </div>
      </section>

      {/* Four tiers */}
      <section className="mx-auto max-w-[1200px] px-4 pb-16 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-4 sm:grid-cols-2">
          <PriceCard
            tier="Free"
            price="$0"
            period="discovery"
            blurb="Explore the catalog and response shapes. Rate-limited, no card."
            features={["Full response schema", "Daily request cap", "No signup"]}
            cta={{ label: "Try it", href: "/products/trading-intelligence#try" }}
          />
          <PriceCard
            tier="Starter Pack"
            price={`$${STARTER_PACK_USD}`}
            period="one-time"
            featured
            blurb="A one-time credit for Trading Intelligence. No subscription."
            features={[`$${STARTER_PACK_USD} API credit`, "Card or UPI", `Spend at $${tiPrice}/call`, "One-time — nothing recurs"]}
            cta={{ label: "Get started", href: "/checkout?plan=starter" }}
            note="Processed by Dodo Payments (card / UPI)"
          />
          <PriceCard
            tier="Pay-per-call"
            price={`$${tiPrice}`}
            period="/ call"
            blurb={`No account, machine-to-machine. Intelligence $${tiPrice} · RPC $${FLAT_RATE_USD}.`}
            features={["x402 (USDC on Base)", "or on-chain USDT deposit", "Zero commitment"]}
            cta={{ label: "For agents", href: "/products/x402" }}
            note="Crypto rail — not processed by Dodo"
          />
          <PriceCard
            tier="Enterprise"
            price="Custom"
            period=""
            blurb="Dedicated keys, spend controls, consolidated invoicing."
            features={["Higher rate limits", "Per-key attribution", "One invoice for the team"]}
            cta={{ label: "Contact sales", href: "/contact-sales" }}
          />
        </div>
      </section>

      {/* Usage calculator */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Estimate" title="Usage calculator" align="left" lede="Prices are read live from the catalog." />
          <div className="mt-8 max-w-2xl">
            <UsageCalculator products={calcProducts} />
          </div>
        </div>
      </section>

      {/* Compare */}
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Compare" title="Which plan fits" align="left" />
        <div className="mt-8">
          <ComparisonTable columns={compareColumns} rows={compareRows} highlightColumn={2} />
        </div>
      </section>

      {/* Rate card (live) */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Rate card" title="What each call costs" align="left" />
          <div className="mt-8 overflow-x-auto rounded-[var(--sl-radius-lg)] border border-sl-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-sl-border px-4 py-3 text-left font-semibold text-sl-text">Endpoint</th>
                  <th className="border-b border-sl-border px-4 py-3 text-left font-semibold text-sl-text">Type</th>
                  <th className="border-b border-sl-border px-4 py-3 text-right font-semibold text-sl-text">Price / call</th>
                </tr>
              </thead>
              <tbody>
                {catalog.metrics.map((m) => (
                  <tr key={m.slug}>
                    <td className="border-b border-sl-border px-4 py-3 text-sl-text-muted">
                      <Link href={`/products/trading-intelligence/${m.slug}`} className="hover:text-sl-accent">
                        /v1/intelligence/{m.slug}
                      </Link>
                    </td>
                    <td className="border-b border-sl-border px-4 py-3 text-sl-text-subtle">
                      {m.isModel ? "derived model / proxy" : "derived"}
                    </td>
                    <td className="border-b border-sl-border px-4 py-3 text-right font-sl-mono tabular-nums text-sl-text">
                      ${m.priceUsd.toFixed(2)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="px-4 py-3 text-sl-text-muted">
                    <Link href="/products/rpc" className="hover:text-sl-accent">/rpc/polygon (JSON-RPC gateway)</Link>
                  </td>
                  <td className="px-4 py-3 text-sl-text-subtle">infrastructure</td>
                  <td className="px-4 py-3 text-right font-sl-mono tabular-nums text-sl-text">${FLAT_RATE_USD}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-sl-text-muted">
            Machine-readable rates:{" "}
            <a href="https://satelink.network/pricing.json" className="font-sl-mono text-sl-accent underline">pricing.json</a>
          </p>
        </div>
      </section>

      {/* Platform pricing anchor (target of /platform/pricing → /pricing#platform) */}
      <section id="platform" className="scroll-mt-24 mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold text-sl-text">How your balance works</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-sl-text-muted">
              <li className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />One payment, one credit pack — not a recurring subscription.</li>
              <li className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />Credits are USD-denominated and spent per call.</li>
              <li className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />Each call deducts its price from a single account balance.</li>
            </ul>
            <div className="mt-4">
              <Disclosure title="Shared balance — disclosed, not walled off">
                A Dodo-funded Starter Pack is sold as Trading Intelligence access, but the credit it adds
                sits in the same account balance that an x402 or on-chain USDT payment funds — so it can
                also be spent on RPC calls. We disclose this rather than claim the two rails are walled
                off. Dodo only ever processes the Starter Pack itself; it never touches the crypto rail.
              </Disclosure>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-sl-text">The x402 rail</h2>
            <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
              x402 is keyless: a service answers an unpaid request with HTTP 402 and machine-readable
              requirements, and the caller pays in USDC on Base ({X402_BUNDLE.calls.toLocaleString()} RPC
              calls for ${X402_BUNDLE.priceUsd}). It is a separate crypto rail Dodo never processes.{" "}
              <Link href="/products/x402" className="text-sl-accent underline">More on x402 →</Link>
            </p>
            <h2 className="mt-8 text-lg font-semibold text-sl-text">Refunds</h2>
            <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
              Dodo-confirmed refunds automatically claw back unused credits; partial refunds reverse
              proportionally. Credits already spent on calls are non-refundable. Full terms are in the{" "}
              <Link href="/refund" className="text-sl-accent underline">Refund &amp; Cancellation Policy</Link>.
            </p>
          </div>
        </div>
      </section>

      {/* Grouped FAQ */}
      <section className="border-t border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[820px] px-4 py-16 sm:px-6">
          <SectionHeader title="Frequently asked" align="left" />
          {[
            { group: "Plans & usage", items: [
              ["Is this a subscription?", "No. The Starter Pack is a one-time purchase and there is no recurring plan. There's nothing to cancel."],
              ["Do I need an account to call the API?", "Not on the x402 rail — it is keyless. Credits and the Starter Pack are account-based."],
            ] },
            { group: "Billing & payments", items: [
              ["Does Dodo process crypto?", "No. Dodo processes only the card/UPI Starter Pack. x402 and USDT are a separate crypto rail."],
              ["Is Trading Intelligence investment advice?", "No. Every endpoint returns derived statistics from public market data. Not advice, and Satelink never takes custody of funds."],
            ] },
            { group: "Refunds", items: [
              ["How do refunds work?", "Dodo-confirmed refunds claw back unused credits; spent credits are non-refundable. See the Refund & Cancellation Policy at /refund."],
            ] },
          ].map((g) => (
            <div key={g.group} className="mt-8 first:mt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{g.group}</p>
              <div className="mt-3 space-y-3">
                {g.items.map(([q, a]) => (
                  <Disclosure key={q} title={q}>{a}</Disclosure>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
