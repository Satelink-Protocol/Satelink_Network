// /network/run-a-node — how node operators earn from the settlement split.
// Factual only: 50/30/20 split, on-chain settlement, links to the existing node
// setup flow (/node/setup). No invented earnings figures.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = buildMetadata({
  title: "Run a node",
  description: "Run a Satelink node and earn a share of metered revenue. Settlement is on-chain to a Polygon vault, split 50% operators / 30% platform / 20% distribution.",
  path: "/network/run-a-node",
});

const STEPS = [
  { title: "Register", body: "Register your node with the network and connect it to the gateway." },
  { title: "Serve traffic", body: "Your node serves metered RPC / intelligence calls." },
  { title: "Earn a share", body: "Revenue is aggregated per epoch and settled on-chain — operators receive 50% of the split." },
];

export default function RunANodePage() {
  return (
    <>
      <Breadcrumbs items={[{ name: "Network", href: "/network" }, { name: "Run a node", href: "/network/run-a-node" }]} />
      <section className="mx-auto max-w-[1000px] px-4 pt-6 sm:px-6">
        <SectionHeader eyebrow="Network" title="Run a node, earn from the split" lede="Node operators serve metered traffic and receive 50% of settled revenue. Settlement is on-chain and verifiable." align="left" />
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg"><Link href="/node/setup">Set up a node <ArrowRight className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="lg"><Link href="/platform/settlement">How settlement works</Link></Button>
        </div>
      </section>

      <section className="mx-auto max-w-[1000px] px-4 py-16 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
              <span className="font-sl-mono text-sm text-sl-text-subtle">0{i + 1}</span>
              <h3 className="mt-2 font-semibold text-sl-text">{s.title}</h3>
              <p className="mt-1.5 text-sm text-sl-text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1000px] px-4 py-14 sm:px-6">
          <SectionHeader eyebrow="The split" title="50 / 30 / 20" align="left" as="h2" />
          <p className="mt-3 max-w-[60ch] text-sm text-sl-text-muted">
            Settled revenue is split 50% to node operators, 30% to the platform, and 20% to the
            distribution pool. Settlement lands in RevenueVaultV2 on Polygon (chain 137), verifiable
            on Polygonscan.
          </p>
        </div>
      </section>
    </>
  );
}
