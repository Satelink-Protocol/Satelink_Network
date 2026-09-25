// /pricing — Pricing V2, claude.com pattern: one answer-first headline, plan
// cards, packs, pay-per-call for software, how payment works, short FAQ.
// Every price and allowance comes from the PlanCatalog (lib/plan-catalog.ts —
// the same config the API and the console Billing page use). No hard-coded
// plan numbers in JSX. Dodo (card/UPI) and the crypto rail stay separate.
import type { Metadata } from "next";
import { buildMetadata, faqLd, jsonLdScript } from "@satelink/seo";
import { TwoRailsDiagram } from "@satelink/web-ui";
import { AGENT_RATE_CARD } from "@/lib/plans";
import { X402_BUNDLE } from "@/lib/products";
import { CONSOLE, planCatalog } from "@/lib/plan-catalog";
import { PlanCards } from "@/components/PlanCards";
import { Disclosure } from "@/components/ui/Disclosure";

export const metadata: Metadata = buildMetadata({
  title: "Pricing",
  description:
    "Satelink pricing: start free, Launch at $5 for the first month then $19, Pro $19 or Max $79 a month — weekly allowances of market-data requests — or pay per call as software: $0.01 per market-data request, $0.00003 per Polygon RPC call. Card/UPI via Dodo; x402 and USDT are a separate crypto rail.",
  path: "/pricing",
});

export default function PricingPage() {
  const catalog = planCatalog();
  const launch = catalog.plans.find((p) => p.id === "launch");
  const free = catalog.plans.find((p) => p.id === "free");
  const faq = [
    { question: "What is a UU?", answer: `A Usage Unit — how plan allowances are counted. 1 UU = $${catalog.unit.usd_list_value} of list price, and one market-data request is 10 UU. The plan cards also say it in requests.` },
    { question: "How do the session and weekly allowances work?", answer: `Each plan has a weekly allowance (resets every Monday in your account's timezone) and a shorter session allowance that refills over a rolling ${catalog.windows.session_hours} hours, so one burst can't use a whole week at once.` },
    { question: "What happens when I reach my allowance?", answer: "You choose: wait for it to refill, let a credit pack or crypto credits cover the rest (credit auto-use), or upgrade. Nothing is charged unless you allow it." },
    ...(launch?.intro ? [{ question: "How does Launch work?", answer: `${launch.intro.copy} Launch includes the same allowance as Pro; cancel before renewal and you won't be charged again.` }] : []),
    { question: "Who processes my payment?", answer: "Card and UPI payments are processed by Dodo Payments, the merchant of record. Plan and pack value pays for market data. RPC and x402 are paid on the crypto rail (USDT credits or keyless x402) and are never billed through Dodo." },
    { question: "Can software pay without an account?", answer: "Yes. With x402 a request that needs payment is answered with HTTP 402 and a price; the software pays in USDC on Base and retries — no signup." },
    { question: "How do refunds work?", answer: "Refunds follow the Refund & Cancellation Policy. A refunded plan or pack is removed from your account; value already used is not refundable." },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqLd(faq)) }} />

      <section className="border-b border-sl-border">
        <div className="mx-auto max-w-[1200px] px-4 pb-14 pt-20 text-center sm:px-6 md:pt-28">
          <h1 className="mx-auto max-w-3xl text-balance font-sl-display text-sl-text" style={{ fontSize: "var(--sl-display-2)", lineHeight: 1.08, letterSpacing: "-0.015em" }}>
            Pay for what your software uses.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-sl-text-muted">
            Start free. Take a plan for a weekly allowance of market data, top up with a pack, or let your software pay per call — no subscription required.
          </p>
        </div>
      </section>

      <section aria-labelledby="plans" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <h2 id="plans" className="sr-only">Plans</h2>
        <PlanCards catalog={catalog} />
        <p className="mt-4 text-center text-[13px] text-sl-text-muted">
          Allowances are for Trading Intelligence market data. {free ? `Free includes about ${free.allowance.weeklyTiRequests.toLocaleString("en-US")} requests a week.` : ""} Prices in USD; local prices at checkout where available.
        </p>
      </section>

      <section aria-labelledby="packs" className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 id="packs" className="font-sl-display text-[1.75rem] leading-tight text-sl-text">Credit packs</h2>
            <p className="mt-3 text-sl-text-muted">Pay once and use market data whenever you like, beyond your plan or instead of one. Packs don&apos;t expire.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3">
            {catalog.packs.map((k) => (
              <li key={k.id} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
                <p className="font-sl-display text-[2rem] leading-none text-sl-text">${k.priceUsd}</p>
                <p className="mt-2 text-[14px] text-sl-text">About {k.tiRequests.toLocaleString("en-US")} requests</p>
                <p className="mt-1 text-[12px] text-sl-text-subtle">{k.grantUu.toLocaleString("en-US")} UU</p>
                {k.purchasable
                  ? <a href={`${CONSOLE}/sign-in?next=${encodeURIComponent("/billing/add")}`} className="mt-4 inline-block text-[14px] font-medium text-sl-accent hover:underline">Buy pack</a>
                  : <p className="mt-4 text-[13px] text-sl-text-muted">Opening soon</p>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="agents" aria-labelledby="agents-h" className="scroll-mt-24 mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 id="agents-h" className="font-sl-display text-[1.75rem] leading-tight text-sl-text">For software and agents: pay per call</h2>
            <p className="mt-3 text-sl-text-muted">No plan needed. Fund a key with USDT, or pay each request keylessly with x402 (${X402_BUNDLE.priceUsd.toFixed(2)} buys {X402_BUNDLE.calls.toLocaleString("en-US")} RPC calls).</p>
          </div>
          <div tabIndex={0} role="region" aria-label="Per-call prices" className="overflow-x-auto rounded-[var(--sl-radius-lg)] border border-sl-border">
            <table className="w-full min-w-[420px] text-left text-[14px]">
              <thead><tr className="border-b border-sl-border text-sl-text-muted"><th scope="col" className="px-4 py-3 font-medium">Product</th><th scope="col" className="px-4 py-3 text-right font-medium">Price per call</th><th scope="col" className="px-4 py-3 font-medium">Paid with</th></tr></thead>
              <tbody>
                {AGENT_RATE_CARD.map((r) => (
                  <tr key={r.product} className="border-b border-sl-border last:border-0">
                    <td className="px-4 py-3 text-sl-text">{r.product}</td>
                    <td className="px-4 py-3 text-right font-sl-mono tabular-nums text-sl-text">${r.price < 0.001 ? r.price.toFixed(5) : r.price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-sl-text-muted">{r.rail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="platform" aria-labelledby="pay-h" className="scroll-mt-24 border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <h2 id="pay-h" className="font-sl-display text-[1.75rem] leading-tight text-sl-text">How payment works</h2>
          <p className="mt-3 max-w-2xl text-sl-text-muted">{catalog.boundary}</p>
          <div className="mt-8"><TwoRailsDiagram /></div>
          <Disclosure title="Merchant of Record — what Dodo sees vs what Satelink sees" className="mt-8 max-w-3xl">
            Dodo Payments is the seller of record for card/UPI: it collects payment, handles tax, and remits net to Satelink.
            Satelink sees payment metadata (never card numbers). The crypto rail (x402/USDT) is customer-initiated and on-chain — Dodo never processes it.
          </Disclosure>
        </div>
      </section>

      <section aria-labelledby="faq-h" className="mx-auto max-w-[820px] px-4 py-16 sm:px-6">
        <h2 id="faq-h" className="font-sl-display text-[1.75rem] leading-tight text-sl-text">Questions</h2>
        <div className="mt-6 divide-y divide-sl-border border-y border-sl-border">
          {faq.map((f) => (
            <details key={f.question} className="group py-4">
              <summary className="cursor-pointer list-none text-[16px] text-sl-text marker:hidden">
                <span className="flex items-center justify-between gap-4">{f.question}<span aria-hidden className="text-sl-text-subtle transition-transform group-open:rotate-45">+</span></span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-sl-text-muted">{f.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
