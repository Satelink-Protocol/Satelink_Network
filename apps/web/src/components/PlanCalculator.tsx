"use client";
// PlanCalculator (§4.6) — enter Trading-Intelligence calls/month, get the
// cheapest option: Free, a pay-as-you-go top-up, Pro, or Max. Math is derived
// from lib/plans.ts (no hardcoded prices). PAYG is costed at the $0.01 list rate.
import * as React from "react";
import { PLANS } from "@/lib/plans";

const TI_LIST = 0.01;

type Option = { id: string; label: string; monthly: number; detail: string; disabled?: boolean };

function options(calls: number): Option[] {
  const free = PLANS.find((p) => p.id === "free")!;
  const pro = PLANS.find((p) => p.id === "pro")!;
  const max = PLANS.find((p) => p.id === "max")!;

  const payg = calls * TI_LIST;
  const proCost = pro.price.monthly + Math.max(0, calls - pro.includedCalls) * (pro.overagePerCall ?? 0);
  const maxCost = max.price.monthly + Math.max(0, calls - max.includedCalls) * (max.overagePerCall ?? 0);

  const opts: Option[] = [
    {
      id: "free",
      label: "Free",
      monthly: calls <= free.includedCalls ? 0 : Infinity,
      detail: calls <= free.includedCalls ? `Within the ${free.includedCalls}/mo free quota` : `Over the ${free.includedCalls}/mo free quota`,
      disabled: calls > free.includedCalls,
    },
    { id: "payg", label: "Pay-as-you-go", monthly: payg, detail: `${calls.toLocaleString()} calls × $${TI_LIST}` },
    { id: "pro", label: "Pro", monthly: proCost, detail: calls <= pro.includedCalls ? "Within Pro's included calls" : `+ ${(calls - pro.includedCalls).toLocaleString()} overage @ $${pro.overagePerCall}` },
    { id: "max", label: "Max", monthly: maxCost, detail: calls <= max.includedCalls ? "Within Max's included calls" : `+ ${(calls - max.includedCalls).toLocaleString()} overage @ $${max.overagePerCall}` },
  ];
  return opts;
}

export function PlanCalculator() {
  const [calls, setCalls] = React.useState(3000);
  const opts = options(calls);
  const cheapest = opts.reduce((a, b) => (b.monthly < a.monthly ? b : a));

  return (
    <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
      <label htmlFor="calc-calls" className="text-sm font-semibold text-sl-text">
        Trading-Intelligence calls per month
      </label>
      <div className="mt-3 flex items-center gap-4">
        <input
          id="calc-calls"
          type="range"
          min={0}
          max={30000}
          step={100}
          value={Math.min(calls, 30000)}
          onChange={(e) => setCalls(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer accent-[var(--sl-accent)]"
          aria-describedby="calc-result"
        />
        <input
          type="number"
          aria-label="Calls per month"
          min={0}
          value={calls}
          onChange={(e) => setCalls(Math.max(0, Number(e.target.value) || 0))}
          className="w-28 rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg-raised px-3 py-1.5 text-right font-sl-mono text-sm tabular-nums text-sl-text"
        />
      </div>

      <p id="calc-result" className="mt-5 text-sm text-sl-text-muted">
        Cheapest option:{" "}
        <span className="font-semibold text-sl-accent">{cheapest.label}</span> at{" "}
        <span className="font-sl-mono font-bold text-sl-text">
          {cheapest.monthly === 0 ? "$0" : `$${cheapest.monthly.toFixed(2)}`}
        </span>{" "}
        / month.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {opts.map((o) => {
          const best = o.id === cheapest.id;
          return (
            <div
              key={o.id}
              className={`rounded-[var(--sl-radius)] border p-3 ${best ? "border-sl-accent bg-sl-accent-soft" : "border-sl-border"}`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-sl-text-muted">{o.label}</p>
              <p className="mt-1 font-sl-mono text-lg font-bold tabular-nums text-sl-text">
                {o.monthly === Infinity ? "n/a" : o.monthly === 0 ? "$0" : `$${o.monthly.toFixed(2)}`}
              </p>
              <p className="mt-1 text-[0.6875rem] leading-snug text-sl-text-muted">{o.detail}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-sl-text-subtle">
        Estimate only. Pay-as-you-go uses the $0.01 list rate; bonus-credit packs lower the effective rate.
      </p>
    </div>
  );
}
