// apps/web/src/app/pricing/page.tsx
//
// Real /pricing route (previously 404 — pricing only existed as a homepage
// anchor for the RPC rail and nowhere for intelligence). Standalone page, no
// nested layout — same pattern as /intelligence and /tasks.
//
// HONESTY: the credit-pack's USD price is set by the actual Dodo product
// (checkout link below) — this page never states a dollar figure for it, so
// there's no way for this page to drift out of sync with what Dodo charges.
// The two metered per-call rates below are the same constants the API bills
// against (apps/api/src/billing/credit_service.mjs: PRICE_PER_CALL_USDT,
// apps/api/src/intelligence/compute.js: METRICS[*].price_usdt).
//
// DODO COMPLIANCE (2026-09-22): Dodo's card/UPI checkout processes payment
// for ONE product — the Trading Intelligence credit pack (a SaaS analytics
// subscription). The RPC gateway is a separate infrastructure product with
// its own free tier and its own crypto-native payment method (x402 / on-chain
// USDT), neither of which Dodo ever touches. We do NOT hide the true,
// existing fact that a credit-pack balance happens to be technically fungible
// across both products (apps/api/src/billing/credit_service.mjs:
// authorizeAndMeter decrements the same api_credits.credits_usdt row
// regardless of call type) — that's disclosed below in "How the balance
// works." What changed is making the Dodo/crypto boundary explicit instead
// of implicit, so a payments reviewer can see at a glance what Dodo is and
// isn't being asked to process.

import Link from "next/link";
import { getCreditPacks } from "@/lib/dodo/credit-packs";
import { CreditPackCard } from "../intelligence/CreditPackCard";

export const metadata = {
  title: "Pricing",
  description:
    "Satelink pricing: buy a one-time USD credit pack, then spend it on derived trading intelligence ($0.01/call) or RPC ($0.00003/call). No subscription, credits never expire.",
};

export default function PricingPage() {
  const creditPacks = getCreditPacks();
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">Satelink Pricing</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        One-time credit packs. No subscription.
      </h1>
      <p className="mt-4 max-w-2xl text-base text-muted-foreground">
        Pay once in USD for access to Satelink Trading Intelligence — a SaaS
        analytics API that returns derived statistics (funding-rate
        divergence, open-interest shifts, market microstructure), never raw
        data resale. Not investment advice, and Satelink never takes custody
        of any funds or assets. No subscription, nothing to cancel.
      </p>

      <div className="mt-10">
        <h2 className="text-sm font-medium text-muted-foreground">Credit pack</h2>
        <p className="mt-2 mb-4 text-base">
          One-time payment via card or UPI (Dodo Payments) for Trading
          Intelligence access, credited to your account 1:1 in USD, no bundle
          discount, no expiry. Dodo processes this analytics-subscription
          payment only — it does not process any crypto payment on this site
          (see the RPC gateway card below).
        </p>
        {creditPacks.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {creditPacks.map((pack) => (
              <CreditPackCard
                key={pack.productId}
                productId={pack.productId}
                label={pack.label}
                usdValue={pack.usdValue}
              />
            ))}
          </div>
        ) : (
          <span className="inline-block rounded-md border border-border px-4 py-2 text-center text-sm text-muted-foreground">
            Checkout link not configured yet
          </span>
        )}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-6">
          <h3 className="text-sm font-medium text-muted-foreground">
            Trading intelligence
          </h3>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-semibold">$0.01</span>
            <span className="text-sm text-muted-foreground">/ call</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Funding-rate heatmaps, open-interest shifts, liquidation clusters,
            market microstructure. Free discovery tier (catalog + prices, no
            cost) at{" "}
            <Link href="/intelligence" className="underline">
              /intelligence
            </Link>
            .
          </p>
        </div>
        <div className="rounded-lg border border-border p-6">
          <h3 className="text-sm font-medium text-muted-foreground">
            RPC gateway <span className="text-xs font-normal">(separate product, not billed through Dodo)</span>
          </h3>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-semibold">$0.00003</span>
            <span className="text-sm text-muted-foreground">/ call</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Multi-chain JSON-RPC infrastructure (Polygon, Ethereum, Base,
            Arbitrum) — a machine-to-machine product, separate from the
            Trading Intelligence subscription above. Free tier: 500
            requests/day per IP, no account required. Machines pay per call
            directly via x402 (USDC on Base) or an on-chain USDT deposit —
            Satelink&rsquo;s own crypto-native rail, which Dodo never
            processes — see{" "}
            <a href="https://docs.satelink.network" className="underline">
              the x402 docs
            </a>
            .
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-border bg-muted/30 p-6">
        <h3 className="text-sm font-medium text-foreground">
          How the balance works
        </h3>
        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <li>· One credit pack, one payment — not a recurring subscription.</li>
          <li>· Credits are USD-denominated and never expire.</li>
          <li>
            · Each call (intelligence or RPC) deducts that call&rsquo;s price
            from the same account balance — a Dodo-funded credit pack is sold
            as Trading Intelligence access, but the balance it credits is the
            same one an x402 or on-chain USDT payment funds, so it is also
            usable for RPC calls. We disclose this rather than claim the two
            are walled off from each other.
          </li>
          <li>· Refunds claw back unused credits — see the{" "}
            <Link href="/refund" className="underline">Refund &amp; Cancellation Policy</Link>.
          </li>
        </ul>
      </div>
    </div>
  );
}
