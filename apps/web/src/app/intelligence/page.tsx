// apps/web/src/app/intelligence/page.tsx
//
// M5 (T-27): product/pricing page for the Dodo human payment rail.
// Standalone page, no nested layout — same pattern as /tasks and /status.
//
// HONESTY NOTE (do not remove without re-checking): the M3 plan (funding
// rate heatmap, open interest shifts, liquidation clusters, market
// microstructure — the four derived-analytics endpoints under
// /v1/intelligence) was never built; M5 shipped before it. Starter/Pro
// checkout and crediting (Dodo -> api_credits, this page's whole point) are
// fully real and gate-tested (see apps/api/test/internal_dodo.test.js) — a
// paying customer gets a real, spendable, billed account today. What that
// account can actually CALL is not live yet. This page must never claim a
// working /v1/intelligence curl example or a live example response — only
// the RPC gateway (x402 $0.00003/call) is real today. Update the "coming
// soon" language the moment M3 ships, not before.

export const metadata = {
  title: "Intelligence — Satelink",
  description:
    "Market intelligence for machine-commerce agents: funding rate heatmaps, open interest shifts, liquidation clusters, market microstructure. Free discovery tier, ₹499 Starter, ₹1,999 Pro, or $0.01/call via x402.",
};

const DODO_STARTER_URL = process.env.NEXT_PUBLIC_DODO_CHECKOUT_STARTER_URL;
const DODO_PRO_URL = process.env.NEXT_PUBLIC_DODO_CHECKOUT_PRO_URL;

type Tier = {
  name: string;
  price: string;
  period: string;
  blurb: string;
  features: string[];
  cta: { label: string; href?: string; disabled?: boolean };
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
    name: "Starter",
    price: "₹499",
    period: "/month",
    blurb: "For a single agent or a small workload.",
    features: ["Higher daily cap", "Card or UPI via Dodo", "Cancel anytime"],
    cta: { label: "Subscribe with Dodo", href: DODO_STARTER_URL },
  },
  {
    name: "Pro",
    price: "₹1,999",
    period: "/month",
    blurb: "For production agents calling continuously.",
    features: ["Highest daily cap", "Card or UPI via Dodo", "Cancel anytime"],
    cta: { label: "Subscribe with Dodo", href: DODO_PRO_URL },
  },
  {
    name: "x402 (pay-per-call)",
    price: "$0.01",
    period: "/call",
    blurb: "No account, no subscription — machine-to-machine, USDC on Base.",
    features: ["Zero-commitment", "Agent-native (HTTP 402)", "No human checkout"],
    cta: { label: "See x402 docs", href: "https://docs.satelink.network" },
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
        market microstructure — derived analytics, not raw quotes. Pay a
        human subscription with a card or UPI, or pay per call as an agent
        with x402. Same underlying account either way.
      </p>

      <div className="mt-6 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        The analytics endpoints are launching soon. Subscribing today reserves
        your account and tier — billing and crediting are live now, the
        endpoints are not yet.
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => (
          <TierCard key={tier.name} tier={tier} />
        ))}
      </div>

      <div className="mt-16 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">API access</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          A Starter or Pro subscription credits your Satelink API key the same
          way an on-chain deposit or an x402 payment does — it is spent per
          call, same billing path as the RPC gateway. Full reference, request
          signing, and the x402 client libraries are documented at{" "}
          <a href="https://docs.satelink.network" className="underline">
            docs.satelink.network
          </a>
          .
        </p>
      </div>
    </div>
  );
}
