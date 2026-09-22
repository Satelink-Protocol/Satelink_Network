// apps/web/src/app/intelligence/page.tsx
//
// Product/pricing page for the trading-intelligence product — Satelink's
// primary product for the Dodo merchant review (see /pricing, which this
// page must match exactly). Standalone page, no nested layout — same
// pattern as /tasks and /status.
//
// PRICING MODEL: one-time USD credit pack (Dodo Payments), spent per call —
// same account, same billing path as an x402 payment or a USDT deposit. No
// subscription by default. Monthly INR subscriptions (Starter/Pro) exist in
// code but stay behind NEXT_PUBLIC_DODO_SUBSCRIPTIONS_ENABLED (default OFF,
// per PR #386 — a subscription-renewal refund can't yet be matched back to
// its funding payment_id) and are never mentioned in copy while the flag is
// off, so this page never states a price the flag would contradict.
//
// HONESTY NOTE (updated, M3 clean rebuild): the four derived-analytics
// endpoints under /v1/intelligence (funding rate heatmap, open interest
// shifts, liquidation clusters, market microstructure) are real
// (src/routes/intelligence_route.js on apps/api) — a paying customer's
// account can actually CALL what it's billed for. The curl example below
// hits the real, live discovery route (GET /v1/intelligence, no auth, no
// cost), verified against the route's own free-discovery handler.
//
// DODO COMPLIANCE (2026-09-22): this is the primary page Dodo reviews for
// the product it's underwriting — a SaaS market-analytics API, derived
// statistics only, not investment advice, no custody. The Free/Starter/Pro
// tiers are the Dodo-billed SaaS tiers; the x402 tier is a separate
// crypto-native machine rail Dodo never processes, and is labeled as such
// below rather than presented as an equivalent Dodo payment option.

import Link from "next/link";
import { getCreditPacks } from "@/lib/dodo/credit-packs";
import { CreditPackCard } from "./CreditPackCard";

const DODO_STARTER_URL = process.env.NEXT_PUBLIC_DODO_CHECKOUT_STARTER_URL;
const DODO_PRO_URL = process.env.NEXT_PUBLIC_DODO_CHECKOUT_PRO_URL;

// Dodo subscriptions are DISABLED by default (flag OFF). Renewal-refund matching
// does not exist yet (a subscription-renewal refund can't be linked back to the
// funding payment_id — see PR #386), so recurring billing must not be sold until
// it does. Set NEXT_PUBLIC_DODO_SUBSCRIPTIONS_ENABLED=true to re-enable.
const SUBSCRIPTIONS_ENABLED =
  process.env.NEXT_PUBLIC_DODO_SUBSCRIPTIONS_ENABLED === "true";

export const metadata = {
  title: "Intelligence — Satelink",
  description: SUBSCRIPTIONS_ENABLED
    ? "Market intelligence for machine-commerce agents: funding rate heatmaps, open interest shifts, liquidation clusters, market microstructure. Free discovery tier, one-time USD credit pack, monthly subscription, or $0.01/call via x402."
    : "Market intelligence for machine-commerce agents: funding rate heatmaps, open interest shifts, liquidation clusters, market microstructure. Free discovery tier, one-time USD credit pack, or $0.01/call via x402.",
};

type Tier = {
  name: string;
  price: string;
  period: string;
  blurb: string;
  features: string[];
  cta: { label: string; href?: string; disabled?: boolean };
  subscription?: boolean; // recurring Dodo billing — hidden unless the flag is on
};

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    period: "discovery",
    blurb: "Explore the product. Rate-limited, no card required.",
    features: ["Daily request cap", "Full response shape", "No credit card"],
    cta: { label: "No signup needed", disabled: true },
  },
  {
    name: "x402 (pay-per-call)",
    price: "$0.01",
    period: "/call",
    blurb:
      "No account, no subscription — machine-to-machine, USDC on Base. A separate crypto rail; not processed by Dodo.",
    features: ["Zero-commitment", "Agent-native (HTTP 402)", "No human checkout"],
    cta: { label: "See x402 docs", href: "https://docs.satelink.network" },
  },
  {
    name: "Starter",
    price: "₹499",
    period: "/month",
    blurb: "For a single agent or a small workload.",
    features: ["Higher daily cap", "Card or UPI via Dodo", "Cancel anytime"],
    cta: { label: "Subscribe with Dodo", href: DODO_STARTER_URL },
    subscription: true,
  },
  {
    name: "Pro",
    price: "₹1,999",
    period: "/month",
    blurb: "For production agents calling continuously.",
    features: ["Highest daily cap", "Card or UPI via Dodo", "Cancel anytime"],
    cta: { label: "Subscribe with Dodo", href: DODO_PRO_URL },
    subscription: true,
  },
];

function TierCard({ tier }: { tier: Tier }) {
  const ctaDisabled = tier.cta.disabled || !tier.cta.href;
  return (
    <div className="flex flex-col rounded-lg border border-border p-6">
      <h3 className="text-sm font-medium text-muted-foreground">{tier.name}</h3>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold">{tier.price}</span>
        <span className="text-sm text-muted-foreground">{tier.period}</span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{tier.blurb}</p>
      <ul className="mt-4 space-y-1.5 text-sm">
        {tier.features.map((f) => (
          <li key={f} className="text-muted-foreground">
            · {f}
          </li>
        ))}
      </ul>
      <div className="mt-6">
        {ctaDisabled ? (
          <span className="block rounded-md border border-border px-4 py-2 text-center text-sm text-muted-foreground">
            {tier.cta.href === undefined && !tier.cta.disabled
              ? "Checkout link not configured yet"
              : tier.cta.label}
          </span>
        ) : (
          <a
            href={tier.cta.href}
            className="block rounded-md bg-foreground px-4 py-2 text-center text-sm font-medium text-background"
          >
            {tier.cta.label}
          </a>
        )}
      </div>
    </div>
  );
}

export default function IntelligencePage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">Satelink Intelligence</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Market intelligence for machine-commerce agents
      </h1>
      <p className="mt-4 max-w-2xl text-base text-muted-foreground">
        Funding rate heatmaps, open interest shifts, liquidation clusters, and
        market microstructure — derived analytics computed from public market
        data, not raw exchange feeds. We never redistribute a raw feed; every
        response is a statistic we compute. Pay once for a USD credit pack
        via card or UPI (Dodo Payments), or pay per call as an agent with
        x402 — a separate crypto rail Dodo does not process
        {SUBSCRIPTIONS_ENABLED ? ", or subscribe monthly" : ""}.
      </p>
      <p className="mt-3 max-w-2xl text-xs text-muted-foreground">
        Not investment advice. Satelink computes and sells statistics derived
        from public market data — it does not recommend trades, manage
        funds, or provide financial advice, and never takes custody of any
        money or crypto asset.
      </p>

      <div className="mt-6 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Try it now — free discovery, no signup:</p>
        <pre className="mt-2 overflow-x-auto rounded bg-background px-3 py-2 text-xs">
          <code>curl https://rpc.satelink.network/v1/intelligence</code>
        </pre>
        <p className="mt-2">
          Lists every metric, its price, and how to pay. Metered calls (e.g.
          <code className="mx-1 rounded bg-background px-1">
            /v1/intelligence/funding-rate-heatmap
          </code>
          ) need a funded API key — a one-time credit pack funds one
          immediately, or fund one yourself via the x402 bundle on{" "}
          <code className="rounded bg-background px-1">/rpc/polygon</code>.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.filter((tier) => SUBSCRIPTIONS_ENABLED || !tier.subscription).map((tier) => (
          <TierCard key={tier.name} tier={tier} />
        ))}
        {getCreditPacks().map((pack) => (
          <CreditPackCard
            key={pack.productId}
            productId={pack.productId}
            label={pack.label}
            usdValue={pack.usdValue}
          />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Full rate card at{" "}
        <Link href="/pricing" className="underline">/pricing</Link>. Refunds
        claw back unused credit-pack balance — see{" "}
        <Link href="/refund" className="underline">Refund &amp; Cancellation</Link>.
      </p>

      <div className="mt-16 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">API access</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          A credit pack funds your Satelink API key the same way an on-chain
          deposit or an x402 payment does — it is spent per call, same
          billing path as the RPC gateway. Full reference, request signing,
          and the x402 client libraries are documented at{" "}
          <a href="https://docs.satelink.network" className="underline">
            docs.satelink.network
          </a>
          .
        </p>
      </div>
    </div>
  );
}
