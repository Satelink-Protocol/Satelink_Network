// "How a machine pays" — the lifecycle, shown three ways: the ring (whole
// loop), the 402 sequence (one call), and four plain steps. All SSR SVG; the
// ring's traversal animation is CSS and stops under prefers-reduced-motion.
import { LifecycleRing, PaymentSequence402, ScrollReveal } from "@satelink/web-ui";
import { SectionHeader } from "@/components/ui/SectionHeader";

const STEPS: [string, string][] = [
  ["Request", "The agent calls a priced endpoint — no account needed on the x402 rail."],
  ["Price", "Unpaid calls get HTTP 402 with machine-readable terms: amount, asset, network, payee."],
  ["Pay", "The agent signs a USDC payment on Base, or draws down prepaid credits with its key."],
  ["Receive", "The call executes and is metered; the payment reference comes back with the response."],
];

export function HowMachinePays() {
  return (
    <section aria-labelledby="how-machine-pays" className="border-b border-sl-border">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader
          eyebrow="Lifecycle"
          title="How a machine pays"
          lede="Discovery to receipt, with no human in the loop."
        />
        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[minmax(0,420px)_1fr]">
          <ScrollReveal>
            <LifecycleRing className="mx-auto w-full max-w-[420px]" />
          </ScrollReveal>
          <div>
            <ol className="grid gap-6 sm:grid-cols-2">
              {STEPS.map(([t, b], i) => (
                <li key={t} className="border-t-2 border-sl-accent pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-text-subtle">Step {i + 1}</p>
                  <h3 className="mt-1 font-semibold text-sl-text">{t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-sl-text-muted">{b}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <ScrollReveal>
          <figure className="mt-14 overflow-x-auto rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-4 sm:p-6">
            <PaymentSequence402 className="mx-auto w-full" />
            <figcaption className="mt-3 text-sm text-sl-text-muted">One call on the x402 rail, message by message.</figcaption>
          </figure>
        </ScrollReveal>
      </div>
    </section>
  );
}
