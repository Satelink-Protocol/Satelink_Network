// /pricing — unified pricing: Free · Starter Pack · Pay-per-call · Corporate.
// The Dodo-billed SaaS product (Starter Pack) is kept explicitly separate from
// the crypto rail (x402/USDT), which Dodo never processes (§2.2). The
// shared-balance disclosure (§2.3) is preserved, rewritten for clarity.
import type { Metadata } from "next";
import Link from "next/link";
import { getCatalog } from "@/lib/intelligence";
import { PriceCard } from "@/components/ui/PriceCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Disclosure } from "@/components/ui/Disclosure";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Satelink pricing: free discovery, a $9.99 one-time Starter Pack (card/UPI via Dodo), $0.01/call pay-per-call via x402/USDT, and custom Corporate Services. No subscription; credits never expire.",
  alternates: { canonical: "https://satelink.network/pricing" },
};

export const revalidate = 300;

export default async function PricingPage() {
  const { catalog } = await getCatalog();

  return (
    <>
      <section className="border-b border-sl-border">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader
            eyebrow="Pricing"
            title="Start free. Pay for what you call."
            lede="Derived market analytics, metered per call. A $9.99 Starter Pack gets you going with card or UPI; agents can pay per call on the crypto rail. No subscription, no expiry."
          />
        </div>
      </section>

      {/* Four tiers */}
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-4 sm:grid-cols-2">
          <PriceCard
            tier="Free"
            price="$0"
            period="discovery"
            blurb="Explore the catalog and response shapes. Rate-limited, no card."
            features={["Full response schema", "Daily request cap", "No signup"]}
            cta={{ label: "Try it", href: "/intelligence#try" }}
          />
          <PriceCard
            tier="Starter Pack"
            price="$9.99"
            period="one-time"
            featured
            blurb="Credited 1:1 as $9.99 of API credit. No expiry, no subscription."
            features={["$9.99 API credit", "Card or UPI", "Spend at $0.01/call", "Credits never expire"]}
            cta={{ label: "Get started", href: "/checkout?plan=starter" }}
            note="Processed by Dodo Payments (card / UPI)"
          />
          <PriceCard
            tier="Pay-per-call"
            price="$0.01"
            period="/ call"
            blurb="No account, machine-to-machine. Intelligence $0.01 · RPC $0.00003."
            features={["x402 (USDC on Base)", "or on-chain USDT deposit", "Zero commitment"]}
            cta={{ label: "For agents", href: "/machine" }}
            note="Crypto rail — not processed by Dodo"
          />
          <PriceCard
            tier="Corporate"
            price="Custom"
            period=""
            blurb="Dedicated keys, custom metrics, consolidated invoicing."
            features={["Higher rate limits", "Scoped custom metrics", "One invoice for the team"]}
            cta={{ label: "Talk to us", href: "/corporate#enquire" }}
          />
        </div>
      </section>

      {/* Rate card */}
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
                      <Link href={`/intelligence/${m.slug}`} className="hover:text-sl-accent">
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
                  <td className="px-4 py-3 text-sl-text-muted">/rpc (JSON-RPC gateway)</td>
                  <td className="px-4 py-3 text-sl-text-subtle">infrastructure</td>
                  <td className="px-4 py-3 text-right font-sl-mono tabular-nums text-sl-text">$0.00003</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Balance + refund */}
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold text-sl-text">How your balance works</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-sl-text-muted">
              <li className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />One payment, one credit pack — not a recurring subscription.</li>
              <li className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />Credits are USD-denominated and never expire.</li>
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
            <h2 className="text-lg font-semibold text-sl-text">Refunds</h2>
            <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
              Dodo-confirmed refunds automatically claw back unused credits; partial refunds reverse
              proportionally. Credits already spent on calls are non-refundable. Full terms are in the{" "}
              <Link href="/refund" className="text-sl-accent underline">Refund &amp; Cancellation Policy</Link>.
            </p>
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-sl-text">FAQ</h3>
              <dl className="mt-3 space-y-4 text-sm">
                {[
                  ["Is this a subscription?", "No. The Starter Pack is a one-time purchase. There's nothing to cancel."],
                  ["Do credits expire?", "No — USD-denominated credits never expire."],
                  ["Is this investment advice?", "No. Every endpoint returns derived statistics from public market data. Not advice, and Satelink never takes custody of funds."],
                  ["Does Dodo process crypto?", "No. Dodo processes only the card/UPI Starter Pack. x402 and USDT are a separate crypto rail."],
                ].map(([q, a]) => (
                  <div key={q}>
                    <dt className="font-medium text-sl-text">{q}</dt>
                    <dd className="mt-1 text-sl-text-muted">{a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
