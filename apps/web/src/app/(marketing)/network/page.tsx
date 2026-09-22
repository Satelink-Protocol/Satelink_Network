// /network — "The infrastructure underneath" (§3 demote). Node operators, the
// 50/30/20 revenue split, settlement, and the vault — moved off the homepage
// and restyled. Numbers are factual; the earnings estimator is labelled
// illustrative.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Cpu, HardDrive, Wifi } from "lucide-react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { EarningsEstimator } from "./EarningsEstimator";

export const metadata: Metadata = {
  title: "Network — the infrastructure underneath",
  description:
    "The nodes, settlement, and revenue split behind Satelink: a multi-chain RPC gateway metered at $0.00003/call, settled on Polygon via RevenueVault V2. 50% to node operators.",
  alternates: { canonical: "https://satelink.network/network" },
};

const SPLIT = [
  { label: "Node operators", pct: 50 },
  { label: "Platform", pct: 30 },
  { label: "Distribution pool", pct: 20 },
];

const REQS = [
  { icon: Cpu, text: "A modern multi-core server" },
  { icon: HardDrive, text: "Synced chain node(s) or a trusted upstream" },
  { icon: Wifi, text: "Stable, low-latency connectivity" },
];

export default function NetworkPage() {
  return (
    <>
      <section className="border-b border-sl-border">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader
            eyebrow="The infrastructure underneath"
            title="Nodes, settlement, and the revenue split"
            lede="Satelink's data products run on a metered multi-chain RPC gateway. Node operators serve the traffic; revenue is aggregated per epoch and settled on-chain."
            align="left"
          />
        </div>
      </section>

      {/* Revenue split */}
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Economics" title="How revenue is split" align="left" />
        <div className="mt-8 overflow-hidden rounded-[var(--sl-radius)] border border-sl-border">
          <div className="flex h-12">
            <div className="flex items-center justify-center bg-sl-accent text-sm font-bold text-sl-accent-ink" style={{ flex: 50 }}>50%</div>
            <div className="flex items-center justify-center bg-sl-accent-strong text-sm font-bold text-sl-accent-ink" style={{ flex: 30 }}>30%</div>
            <div className="flex items-center justify-center bg-sl-info text-sm font-bold text-sl-accent-ink" style={{ flex: 20 }}>20%</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-sl-text-muted">
          {SPLIT.map((s) => (
            <span key={s.label}><span className="font-sl-mono font-semibold text-sl-text">{s.pct}%</span> {s.label}</span>
          ))}
        </div>
      </section>

      {/* Operators + estimator */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <SectionHeader eyebrow="Node operators" title="Serve traffic, earn a share" align="left" />
              <ul className="mt-6 space-y-3 text-sm text-sl-text-muted">
                {REQS.map((r) => (
                  <li key={r.text} className="flex items-center gap-3">
                    <span className="inline-flex size-8 items-center justify-center rounded-[var(--sl-radius-sm)] bg-sl-accent-soft text-sl-accent">
                      <r.icon className="size-4" />
                    </span>
                    {r.text}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Button asChild><Link href="/node">Run a node <ArrowRight className="size-4" /></Link></Button>
              </div>
            </div>
            <EarningsEstimator />
          </div>
        </div>
      </section>

      {/* Settlement + vault */}
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Settlement" title="Aggregated per epoch, settled on Polygon" align="left" />
        <div className="mt-8 rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
          <p className="text-sm leading-relaxed text-sl-text-muted">
            Revenue is aggregated per epoch and settled in USDT on Polygon via RevenueVault V2. The vault
            is permissionless and on-chain-verifiable.
          </p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-[0.08em] text-sl-text-subtle">RevenueVault V2</dt>
              <dd className="mt-1 break-all font-sl-mono text-xs text-sl-text-muted">
                <a href="https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF" className="text-sl-accent underline">
                  0x577D3716d6Ad5b676d230f5409deF9838FABaCEF
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.08em] text-sl-text-subtle">Chain</dt>
              <dd className="mt-1 font-sl-mono text-xs text-sl-text-muted">Polygon PoS (137) · settled in USDT</dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
