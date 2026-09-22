"use client";
// Illustrative node-earnings estimator. Output is explicitly labelled an
// estimate at the current $0.00003/call rate and the 50% operator share
// (§3) — it is not a promise of earnings.
import * as React from "react";

const RATE_PER_CALL = 0.00003;
const OPERATOR_SHARE = 0.5;

export function EarningsEstimator() {
  const [callsPerDay, setCallsPerDay] = React.useState(500_000);
  const monthly = callsPerDay * 30 * RATE_PER_CALL * OPERATOR_SHARE;

  return (
    <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
      <label htmlFor="calls" className="flex items-center justify-between text-sm text-sl-text-muted">
        <span>Calls served / day</span>
        <span className="font-sl-mono font-semibold text-sl-text">{callsPerDay.toLocaleString()}</span>
      </label>
      <input
        id="calls"
        type="range"
        min={10_000}
        max={5_000_000}
        step={10_000}
        value={callsPerDay}
        onChange={(e) => setCallsPerDay(Number(e.target.value))}
        className="mt-3 w-full accent-[var(--sl-accent)]"
      />
      <div className="mt-6 rounded-[var(--sl-radius)] border border-sl-border bg-sl-bg-raised p-5 text-center">
        <p className="text-xs uppercase tracking-[0.08em] text-sl-text-subtle">Illustrative monthly estimate</p>
        <p className="mt-1 font-sl-mono text-3xl font-bold tabular-nums text-sl-accent">
          ${monthly.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-sl-text-subtle">
        Illustrative estimate at the current $0.00003/call rate and 50% operator share. Actual earnings
        depend on real traffic routed to your node and are not guaranteed.
      </p>
    </div>
  );
}
