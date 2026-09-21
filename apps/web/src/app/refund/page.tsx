// apps/web/src/app/refund/page.tsx
//
// New route — no prior refund/cancellation policy existed anywhere on the
// site (a compliance gap for payments review). Describes actual system
// behavior only, matching apps/api/src/routes/internal_dodo.js's refund/
// dispute handling (POST /internal/dodo/reversal) exactly — nothing here is
// aspirational or invented.
import Link from "next/link";
import { LegalFooterLinks } from "@/components/legal-footer-links";

export const metadata = {
  title: "Refund & Cancellation Policy",
  description:
    "How refunds and payment disputes are handled: unused credits are clawed back automatically, already-spent credits are non-refundable and place the account on hold, disputes freeze credits pending resolution.",
};

export default function RefundPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Refund &amp; Cancellation Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: September 2026</p>

      <div className="mt-8 space-y-6 text-base text-muted-foreground">
        <section>
          <h2 className="text-xl font-semibold text-foreground">Cancellation</h2>
          <p className="mt-2">
            Credit packs are one-time, non-recurring payments — there is
            nothing to &ldquo;cancel.&rdquo; If Dodo subscriptions are ever
            enabled for a product, they can be cancelled at any time and stop
            at the end of the current billing period; no partial-period
            refund is issued for a subscription cancellation.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">Refunds — what actually happens</h2>
          <p className="mt-2">
            When Dodo Payments confirms a refund to us, the affected amount
            is reversed on your account automatically:
          </p>
          <ul className="mt-2 list-disc space-y-2 pl-6">
            <li>
              <strong className="text-foreground">Unused credits are clawed back.</strong>{" "}
              A full refund reverses the entire amount that payment
              credited; a partial refund reverses the proportional amount.
              This comes out of your spendable balance.
            </li>
            <li>
              <strong className="text-foreground">Already-consumed credits are non-refundable.</strong>{" "}
              If you&rsquo;ve already spent some or all of what that payment
              credited (on intelligence or RPC calls), the clawback is capped
              at whatever is left in your balance — we don&rsquo;t claw back
              calls you&rsquo;ve already received.
            </li>
            <li>
              <strong className="text-foreground">A shortfall places your account on hold.</strong>{" "}
              If the clawback can&rsquo;t be fully covered by your remaining
              balance (because credits were already spent), your account is
              flagged <code className="rounded bg-muted px-1 py-0.5 text-sm">payment_hold</code>{" "}
              and paid calls return <code className="rounded bg-muted px-1 py-0.5 text-sm">402</code>{" "}
              until the hold is manually cleared.
            </li>
            <li>
              A full refund on a subscription payment also cancels that
              subscription&rsquo;s entitlement.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">Payment disputes / chargebacks</h2>
          <p className="mt-2">A card dispute follows its own lifecycle:</p>
          <ul className="mt-2 list-disc space-y-2 pl-6">
            <li>
              <strong className="text-foreground">Opened:</strong> the credits that payment
              granted are immediately frozen — moved to a held, unspendable
              balance. This does not affect credits from other payments.
            </li>
            <li>
              <strong className="text-foreground">Resolved in our favor</strong> (won /
              cancelled): the frozen credits are released back to your
              spendable balance.
            </li>
            <li>
              <strong className="text-foreground">Resolved against us</strong> (lost /
              accepted): the frozen credits are forfeited and clawed back,
              same shortfall/hold behavior as a refund above.
            </li>
            <li>
              <strong className="text-foreground">Expired</strong> with no clear outcome:
              credits stay frozen and we resolve it manually — never
              auto-released or auto-clawed-back on an ambiguous outcome.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">How to request a refund</h2>
          <p className="mt-2">
            Refunds for a Dodo Payments purchase are requested through Dodo
            or by contacting us directly — see{" "}
            <Link href="/contact" className="underline">Contact</Link>. Once
            Dodo confirms the refund, the account-side reversal above happens
            automatically; there is no separate manual step on our side.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">Idempotency and record-keeping</h2>
          <p className="mt-2">
            Every refund and dispute event is recorded once, even if the
            payment processor retries its notification — you will not be
            charged or refunded twice for the same event. Reversals are
            recorded as their own ledger entries; the original payment record
            is never altered or deleted.
          </p>
        </section>
      </div>

      <LegalFooterLinks />
    </div>
  );
}
