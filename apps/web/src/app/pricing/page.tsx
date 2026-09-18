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

import Link from "next/link";
import { LegalFooterLinks } from "@/components/legal-footer-links";

export const metadata = {
  title: "Pricing",
  description:
    "Satelink pricing: buy a one-time USD credit pack, then spend it on derived trading intelligence ($0.01/call) or RPC ($0.00003/call). No subscription, credits never expire.",
};

const DODO_CREDIT_PACK_URL = process.env.NEXT_PUBLIC_DODO_CHECKOUT_CREDIT_PACK_URL;

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">Satelink Pricing</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        One-time credit packs. No subscription.
      </h1>
      <p className="mt-4 max-w-2xl text-base text-muted-foreground">
        Pay once in USD, get a credit balance that never expires, and spend it
        as you go — on derived trading intelligence, RPC calls, or both. There
        is no recurring charge and nothing to cancel.
      </p>

      <div className="mt-10 rounded-lg border border-border p-6">
        <h2 className="text-sm font-medium text-muted-foreground">Credit pack</h2>
        <p className="mt-2 text-base">
          One-time payment via card or UPI (Dodo Payments). The exact amount
          is set at checkout — whatever you pay is credited to your account
          1:1 in USD, no bundle discount, no expiry.
        </p>
        <div className="mt-4">
          {DODO_CREDIT_PACK_URL ? (
            <a
              href={DODO_CREDIT_PACK_URL}
              className="inline-block rounded-md bg-foreground px-4 py-2 text-center text-sm font-medium text-background"
            >
              Buy a credit pack
            </a>
          ) : (
            <span className="inline-block rounded-md border border-border px-4 py-2 text-center text-sm text-muted-foreground">
              Checkout link not configured yet
            </span>
          )}
        </div>
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
          <h3 className="text-sm font-medium text-muted-foreground">RPC gateway</h3>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-semibold">$0.00003</span>
            <span className="text-sm text-muted-foreground">/ call</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Multi-chain JSON-RPC (Polygon, Ethereum, Base, Arbitrum). Free
            tier: 500 requests/day per IP, no account required. Machines can
            also pay per call directly via x402 (USDC on Base) with no
            account at all — see{" "}
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
          <li>· Each call (intelligence or RPC) deducts that call&rsquo;s price from the balance.</li>
          <li>· Refunds claw back unused credits — see the{" "}
            <Link href="/refund" className="underline">Refund &amp; Cancellation Policy</Link>.
          </li>
        </ul>
      </div>

      <LegalFooterLinks />
    </div>
  );
}
