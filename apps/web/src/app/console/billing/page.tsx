// Console → Billing (web-v3 P6). Current plan, upgrade/top-up, Dodo receipts,
// and x402/USDT deposit history. Upgrades only when PLANS_ENABLED; receipts and
// deposit history come from Track B, so they show empty states (never "—").
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, ConsoleEmpty, KpiTile } from "../_components";
import { Disclosure } from "@/components/ui/Disclosure";
import { CREDIT_PACKS } from "@/lib/plans";
import { ExplorePlans } from "@/components/ExplorePlans";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <>
      <PageHeader title="Billing" lede="Your plan, credit balance, top-ups, and receipts." />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiTile label="Current plan" value="Free" hint="300 Trading-Intelligence calls / month" />
        <KpiTile label="Credit balance" value="$0.00" hint="Prepaid, spent per call" />
        <KpiTile label="Plan allowance used" value={null} hint="No plan yet" />
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold text-sl-text">Upgrade your plan</h2>
        <ExplorePlans compareHref="/pricing#compare" />
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold text-sl-text">Top up with a credit pack</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {CREDIT_PACKS.map((p) => (
            <div key={p.id} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 text-center">
              <p className="font-sl-mono text-2xl font-bold tabular-nums text-sl-text">${p.price}</p>
              <p className="mt-1 text-sm text-sl-text-muted">{p.label}</p>
              <Link
                href={p.live ? "/checkout?plan=starter" : "/contact-sales?topic=plans"}
                className="mt-4 inline-block rounded-[var(--sl-radius)] border border-sl-border px-4 py-2 text-sm font-semibold text-sl-text hover:bg-sl-surface-hover"
              >
                {p.live ? "Buy pack" : "Notify me"}
              </Link>
            </div>
          ))}
        </div>
        <div className="mt-4 max-w-2xl">
          <Disclosure title="How billing works">
            Card and UPI purchases are processed by Dodo Payments as Merchant of Record — receipts and
            invoices come from your Dodo customer portal. The crypto rail (x402/USDT) is separate and not
            billed through Dodo. Trading Intelligence is analytics from public data, not investment advice.
          </Disclosure>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Panel title="Receipts & invoices (Dodo)">
          <ConsoleEmpty title="No receipts yet" body="Card/UPI receipts and invoices from Dodo will appear here once you make a purchase." />
        </Panel>
        <Panel title="Deposit history (x402 / USDT)">
          <ConsoleEmpty title="No deposits yet" body="On-chain deposits on the crypto rail will appear here with their transaction hashes." />
        </Panel>
      </div>
    </>
  );
}
