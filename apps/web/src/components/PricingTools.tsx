"use client";
// Pricing interactives (§8): an audience switch (Humans · Developers · Machines
// & agents · Enterprise) and a usage calculator. Both run over server-supplied
// live prices — no hardcoded catalog numbers, so pricing-parity holds. The
// calculator is a plain estimate (calls × unit price); it never promises spend.
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export type Audience = {
  id: string;
  label: string;
  headline: string;
  body: string;
  cta: { label: string; href: string };
};

export function AudienceSwitch({ audiences }: { audiences: Audience[] }) {
  const [active, setActive] = React.useState(audiences[0].id);
  const current = audiences.find((a) => a.id === active) ?? audiences[0];

  return (
    <div>
      <div role="tablist" aria-label="Pricing by audience" className="flex flex-wrap gap-1.5">
        {audiences.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={a.id === active}
            onClick={() => setActive(a.id)}
            className="rounded-[var(--sl-radius-pill)] border border-sl-border px-4 py-1.5 text-sm font-medium text-sl-text-muted transition-colors hover:text-sl-text aria-selected:border-sl-accent aria-selected:bg-sl-accent aria-selected:text-sl-accent-ink"
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="mt-6 rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
        <h3 className="text-lg font-semibold text-sl-text">{current.headline}</h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-sl-text-muted">{current.body}</p>
        <Link href={current.cta.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
          {current.cta.label} <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

export function UsageCalculator({
  products,
}: {
  /** Live unit prices, in USD per call. */
  products: { id: string; label: string; unitPrice: number }[];
}) {
  const [productId, setProductId] = React.useState(products[0].id);
  const [calls, setCalls] = React.useState(10000);

  const product = products.find((p) => p.id === productId) ?? products[0];
  const estimate = product.unitPrice * calls;

  return (
    <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="calc-product" className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">Product</label>
          <select
            id="calc-product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="mt-2 w-full rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-3 py-2 text-sm text-sl-text focus:border-sl-accent focus:outline-none"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.label} — ${p.unitPrice}/call</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="calc-calls" className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">Calls per month</label>
          <input
            id="calc-calls"
            type="number"
            min={0}
            step={1000}
            value={calls}
            onChange={(e) => setCalls(Math.max(0, Number(e.target.value) || 0))}
            className="mt-2 w-full rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-3 py-2 font-sl-mono text-sm tabular-nums text-sl-text focus:border-sl-accent focus:outline-none"
          />
        </div>
      </div>
      <div className="mt-6 flex items-baseline justify-between border-t border-sl-border pt-5">
        <span className="text-sm text-sl-text-muted">Estimated monthly spend</span>
        <span className="font-sl-mono text-2xl font-bold tabular-nums text-sl-text">
          ${estimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <p className="mt-3 text-xs text-sl-text-subtle">
        An estimate — {calls.toLocaleString()} calls × ${product.unitPrice} per call. You are only ever
        charged for calls you make.
      </p>
    </div>
  );
}
