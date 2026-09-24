export default function Home() {
  return (
    <>
      <section className="py-20 sm:py-28">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-[var(--accent)]">
          Machine-commerce infrastructure
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Software that lets machines pay for what they use.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-[var(--muted)]">
          Jakuraa builds the rails for the machine economy — where autonomous
          agents and services transact directly, per call, and settle on-chain.
          Our first network is{" "}
          <a href="https://satelink.network" className="text-[var(--fg)] underline decoration-[var(--accent)] underline-offset-4">
            Satelink
          </a>
          .
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="https://satelink.network"
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-black hover:opacity-90"
          >
            Explore Satelink ↗
          </a>
          <a
            href="/about"
            className="rounded-md border border-[var(--line)] px-4 py-2.5 text-sm font-medium hover:border-[var(--accent)]"
          >
            About Jakuraa
          </a>
        </div>
      </section>

      <section className="border-t border-[var(--line)] py-16">
        <h2 className="text-2xl font-semibold tracking-tight">What we build</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--line)] p-5">
            <h3 className="font-medium">Pay-per-call access</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Metered blockchain RPC and data APIs priced per request — no seats,
              no subscriptions required for machines.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--line)] p-5">
            <h3 className="font-medium">On-chain settlement</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Usage settles in stablecoins. Agents fund a balance or pay inline;
              the ledger is verifiable.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--line)] p-5">
            <h3 className="font-medium">Built for agents</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Machine-readable pricing, standard payment challenges, and SDK-first
              onboarding so software can integrate without a human in the loop.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--line)] py-16">
        <div className="rounded-lg border border-[var(--line)] p-8">
          <h2 className="text-xl font-semibold tracking-tight">Satelink</h2>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            Satelink is Jakuraa&apos;s machine-commerce network: a gateway where
            machines and AI agents pay per call for blockchain RPC and data,
            settling on-chain. It is live in production.
          </p>
          <a
            href="https://satelink.network"
            className="mt-5 inline-block text-sm font-medium text-[var(--fg)] underline decoration-[var(--accent)] underline-offset-4"
          >
            Visit satelink.network ↗
          </a>
        </div>
      </section>
    </>
  );
}
