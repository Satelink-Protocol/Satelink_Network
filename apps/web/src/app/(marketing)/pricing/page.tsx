// /pricing (web-v3 P3) — the claude.com/pricing pattern:
// H1 → audience toggle (Individuals · Agents & API · Enterprise·later) →
// [Individuals: plan cards (monthly/yearly) + PAYG packs + usage calculator]
// [Agents & API: rate card + x402] [Enterprise: coming later] →
// "How payments work" (two-rails infographic) → Compare features (full matrix,
// §4.2) → balance/refund (#platform) → grouped FAQ. Every card/row is
// config-driven (lib/plans.ts) — no hardcoded numbers in JSX. Dodo is kept
// explicitly separate from the crypto rail (x402/USDT).
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata, faqLd, jsonLdScript } from "@satelink/seo";
import { TwoRailsDiagram } from "@satelink/web-ui";
import { getCatalog } from "@/lib/intelligence";
import { FLAT_RATE_USD, X402_BUNDLE, STARTER_PACK_USD } from "@/lib/products";
import { CREDIT_PACKS, AGENT_RATE_CARD, plansEnabled } from "@/lib/plans";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Disclosure } from "@/components/ui/Disclosure";
import { Button } from "@/components/ui/Button";
import { ExplorePlans } from "@/components/ExplorePlans";
import { PlanCalculator } from "@/components/PlanCalculator";
import { PricingAudienceTabs } from "@/components/PricingAudienceTabs";
import { CompareMatrix } from "@/components/CompareMatrix";

export const metadata: Metadata = buildMetadata({
  title: "Pricing",
  description:
    "Satelink pricing: start Free (300 Trading-Intelligence calls/month), upgrade to Pro or Max, or pay per call as an agent — $0.01/intelligence call, $0.00003/RPC call. Card/UPI via Dodo; x402/USDT is a separate crypto rail, not billed through Dodo. No subscription required.",
  path: "/pricing",
});

export const revalidate = 300;

const FAQ_GROUPS = [
  {
    group: "Plans and usage",
    items: [
      { question: "Do I need a plan?", answer: "No. Start Free with 300 Trading-Intelligence calls a month, buy a one-time credit pack, or pay per call as an agent. Plans (Pro/Max) add included calls, more keys, and support." },
      { question: "What happens when I run out of included calls?", answer: "On Free you upgrade or top up. On Pro and Max, overage is drawn from credits at $0.008 and $0.007 per call respectively — below the $0.01 list rate." },
    ],
  },
  {
    group: "Billing and payments",
    items: [
      { question: "Who processes my payment?", answer: "Card and UPI payments are processed by Dodo Payments as the Merchant of Record — Dodo is the seller of record and handles tax. x402 and USDT are customer-initiated on-chain transfers that Dodo never touches." },
      { question: "Is Trading Intelligence investment advice?", answer: "No. Every endpoint returns derived statistics from public market data. It is not investment advice, and Satelink never takes custody of funds." },
    ],
  },
  {
    group: "Refunds and cancellation",
    items: [
      { question: "How do refunds work?", answer: "Dodo-confirmed refunds automatically claw back unused credits; partial refunds reverse proportionally. Credits already spent on calls are non-refundable. Full terms are in the Refund & Cancellation Policy." },
      { question: "How do I cancel a plan?", answer: "When plans are live, a subscription cancels at the end of the current period with no partial refund unless required by law. There is nothing to cancel on pay-as-you-go." },
    ],
  },
  {
    group: "Agents & x402",
    items: [
      { question: "Can an agent pay without an account?", answer: "Yes. x402 is keyless: the service answers an unpaid request with HTTP 402 and machine-readable requirements, and the agent pays in USDC on Base — no signup." },
      { question: "Which rail funds which product?", answer: "Card/UPI credit (via Dodo) is spendable on Trading Intelligence; the crypto rail (x402/USDT) funds RPC and all machine endpoints. See the two rails diagram above." },
    ],
  },
];

export default async function PricingPage() {
  const { catalog } = await getCatalog();
  const tiPrice = catalog.metrics[0]?.priceUsd ?? 0.01;
  const enabled = plansEnabled();
  const allFaq = FAQ_GROUPS.flatMap((g) => g.items);

  // ── Individuals panel ────────────────────────────────────────────
  const individuals = (
    <div className="space-y-16">
      <ExplorePlans compareHref="#compare" />

      {/* Pay-as-you-go packs strip */}
      <div>
        <h3 className="text-center text-sm font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">
          Or pay as you go — credit packs
        </h3>
        <div className="mx-auto mt-6 grid max-w-3xl gap-4 sm:grid-cols-3">
          {CREDIT_PACKS.map((pack) => {
            const actionable = pack.live || enabled;
            return (
              <div key={pack.id} className="flex flex-col rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 text-center">
                <p className="font-sl-mono text-2xl font-bold tabular-nums text-sl-text">${pack.price}</p>
                <p className="mt-1 text-sm text-sl-text-muted">{pack.label}</p>
                {pack.bonusPct > 0 && (
                  <p className="mt-1 text-xs font-semibold text-sl-accent">+{pack.bonusPct}% bonus credit</p>
                )}
                <div className="mt-4">
                  {actionable ? (
                    <Button asChild variant="secondary" size="sm" className="w-full">
                      <Link href={pack.live ? "/checkout?plan=starter" : `/checkout?plan=${pack.id}`}>Buy pack</Link>
                    </Button>
                  ) : (
                    <Button asChild variant="secondary" size="sm" className="w-full">
                      <Link href="/contact-sales?topic=plans">Notify me</Link>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-center text-xs text-sl-text-subtle">
          Card / UPI via Dodo Payments (Merchant of Record). Credit is spendable on Trading Intelligence.
        </p>
      </div>

      {/* Usage calculator */}
      <div>
        <SectionHeader eyebrow="Estimate" title="Which option is cheapest?" align="left" />
        <div className="mt-6">
          <PlanCalculator />
        </div>
      </div>
    </div>
  );

  // ── Agents & API panel ───────────────────────────────────────────
  const agents = (
    <div id="agents" className="scroll-mt-24 space-y-10">
      <div>
        <SectionHeader eyebrow="Rate card" title="Agents & API — pay per call" align="left"
          lede="No plan, no commitment. Keyless x402 or prepaid credits." />
        <div tabIndex={0} role="region" aria-label="Price table" className="mt-6 overflow-x-auto rounded-[var(--sl-radius-lg)] border border-sl-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-sl-border px-4 py-3 text-left font-semibold text-sl-text">Product</th>
                <th className="border-b border-sl-border px-4 py-3 text-left font-semibold text-sl-text">Unit</th>
                <th className="border-b border-sl-border px-4 py-3 text-right font-semibold text-sl-text">Price</th>
                <th className="border-b border-sl-border px-4 py-3 text-left font-semibold text-sl-text">Rail</th>
              </tr>
            </thead>
            <tbody>
              {AGENT_RATE_CARD.map((r) => (
                <tr key={r.product}>
                  <td className="border-b border-sl-border px-4 py-3 text-sl-text-muted">{r.product}</td>
                  <td className="border-b border-sl-border px-4 py-3 text-sl-text-subtle">{r.unit}</td>
                  <td className="border-b border-sl-border px-4 py-3 text-right font-sl-mono tabular-nums text-sl-text">${r.price}</td>
                  <td className="border-b border-sl-border px-4 py-3 text-sl-text-subtle">{r.rail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-sl-text-muted">
          Machine-readable rates:{" "}
          <a href="https://satelink.network/pricing.json" className="font-sl-mono text-sl-accent underline">pricing.json</a>
          {"  ·  "}x402 stays list price (keyless, crypto-native) — not billed through Dodo.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
          <h3 className="font-semibold text-sl-text">The x402 rail</h3>
          <p className="mt-2 text-sm leading-relaxed text-sl-text-muted">
            A service answers an unpaid request with HTTP 402 and machine-readable requirements; the caller
            pays in USDC on Base ({X402_BUNDLE.calls.toLocaleString()} RPC calls for ${X402_BUNDLE.priceUsd}).
            A separate crypto rail Dodo never processes.{" "}
            <Link href="/products/x402" className="text-sl-accent underline">More on x402 →</Link>
          </p>
        </div>
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
          <h3 className="font-semibold text-sl-text">Prepaid credits</h3>
          <p className="mt-2 text-sm leading-relaxed text-sl-text-muted">
            Fund a balance with USDT and draw it down per call at the flat rate (${FLAT_RATE_USD}/RPC call).
            No subscription; spend is bounded by the balance and per-key limits.
          </p>
        </div>
      </div>
    </div>
  );

  // ── Enterprise panel ─────────────────────────────────────────────
  const enterprise = (
    <div className="mx-auto max-w-xl rounded-[var(--sl-radius-lg)] border border-dashed border-sl-border bg-sl-surface p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">Enterprise</p>
      <h3 className="mt-2 font-sl-display text-2xl font-normal text-sl-text">Coming later</h3>
      <p className="mx-auto mt-3 max-w-md text-sm text-sl-text-muted">
        Dedicated keys, spend controls, per-key attribution, and consolidated invoicing. Talk to us about
        an early engagement.
      </p>
      <div className="mt-5">
        <Button asChild size="md"><Link href="/contact-sales?topic=enterprise">Contact sales</Link></Button>
      </div>
    </div>
  );

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqLd(allFaq)) }} />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-sl-border">
        <div className="sl-grad-hero pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-[1200px] px-4 py-16 text-center sm:px-6 md:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Pricing</p>
          <h1 className="mx-auto mt-3 max-w-[20ch] text-balance font-sl-display text-4xl font-normal tracking-[-0.02em] text-sl-text sm:text-5xl">
            Pay for what a machine calls.
          </h1>
          <p className="mx-auto mt-5 max-w-[62ch] text-lg text-sl-text-muted">
            Start Free, upgrade to Pro or Max, or pay per call as an agent. Trading Intelligence from
            ${tiPrice}/call · RPC ${FLAT_RATE_USD}/call. No subscription required.
          </p>
        </div>
      </section>

      {/* Audience toggle + panels */}
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <PricingAudienceTabs individuals={individuals} agents={agents} enterprise={enterprise} />
      </section>

      {/* How payments work — two rails */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="How payments work" title="Two rails, one boundary" align="left"
            lede="Card/UPI (Dodo) funds Trading Intelligence; x402/USDT funds RPC and the machine rail. Balances never cross." />
          <div className="mt-8 flex justify-center rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-4">
            <TwoRailsDiagram />
          </div>
        </div>
      </section>

      {/* Compare features */}
      <section id="compare" className="scroll-mt-24 mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Compare" title="Compare features across plans" align="left" />
        <div className="mt-8">
          <CompareMatrix />
        </div>
      </section>

      {/* Balance & refunds — target of /platform/pricing → /pricing#platform */}
      <section id="platform" className="scroll-mt-24 border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-lg font-semibold text-sl-text">How your balance works</h2>
              <ul className="mt-4 space-y-2.5 text-sm text-sl-text-muted">
                <li className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />Credits are prepaid service usage — not stored value, not transferable, not redeemable for cash.</li>
                <li className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />Card/UPI credit (Dodo) is spent on Trading Intelligence; the crypto rail funds RPC and all machine endpoints.</li>
                <li className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />Each call deducts its price from the balance; spend is bounded by per-key limits.</li>
              </ul>
              <div className="mt-4">
                <Disclosure title="Merchant of Record — what Dodo sees vs what Satelink sees">
                  Dodo Payments is the seller of record for card/UPI: it collects payment, handles tax, and
                  remits net to Satelink. Satelink sees payment metadata (never card numbers). The crypto rail
                  (x402/USDT) is customer-initiated and on-chain — Dodo never processes it.
                </Disclosure>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-sl-text">Refunds & cancellation</h2>
              <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
                Dodo-confirmed refunds automatically claw back unused credits; partial refunds reverse
                proportionally. Credits already spent on calls are non-refundable. x402/USDT are irreversible
                on-chain transfers (no refund except a service failure). Full terms:{" "}
                <Link href="/refund" className="text-sl-accent underline">Refund &amp; Cancellation Policy</Link>.
              </p>
              <h2 className="mt-8 text-lg font-semibold text-sl-text">The one-time Starter Pack</h2>
              <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
                A ${STARTER_PACK_USD} one-time pack funds a Trading-Intelligence balance you spend per call —
                the only paid option live today alongside x402. No subscription, nothing to cancel.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Grouped FAQ */}
      <section className="mx-auto max-w-[820px] px-4 py-16 sm:px-6">
        <SectionHeader title="Frequently asked" align="left" />
        {FAQ_GROUPS.map((g) => (
          <div key={g.group} className="mt-8 first:mt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{g.group}</p>
            <div className="mt-3 space-y-3">
              {g.items.map((f) => (
                <Disclosure key={f.question} title={f.question}>{f.answer}</Disclosure>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
