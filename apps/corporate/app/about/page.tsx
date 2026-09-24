import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Jakuraa builds infrastructure for the machine economy and operates the Satelink machine-commerce network.",
};

export default function About() {
  return (
    <>
      <section className="py-16 sm:py-20">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">About Jakuraa</h1>
        <p className="mt-6 max-w-2xl text-lg text-[var(--muted)]">
          Jakuraa is a software company building the payment and access rails for
          the machine economy — a world where autonomous agents and services buy
          exactly what they need, per call, and settle on-chain.
        </p>
      </section>

      <section className="border-t border-[var(--line)] py-14">
        <h2 className="text-2xl font-semibold tracking-tight">What we&apos;re doing</h2>
        <div className="mt-6 max-w-2xl space-y-4 text-[var(--muted)]">
          <p>
            Most infrastructure assumes a human with a credit card and a monthly
            plan. Machines don&apos;t work that way: they appear, do work, and pay
            for the precise resources they consume.
          </p>
          <p>
            We build metered, machine-readable services with usage-based pricing
            and on-chain settlement, so software can onboard and pay without a
            human in the loop.
          </p>
          <p>
            Our first network,{" "}
            <a
              href="https://satelink.network"
              className="text-[var(--fg)] underline decoration-[var(--accent)] underline-offset-4"
            >
              Satelink
            </a>
            , delivers pay-per-call blockchain RPC and data with on-chain
            settlement. It is live in production.
          </p>
        </div>
      </section>
    </>
  );
}
