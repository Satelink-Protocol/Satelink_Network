"use client";

// Shared correctness primitives for the admin dashboard.
//
// WHY THIS EXISTS
// Several admin pages historically rendered hardcoded placeholder arrays
// (fake revenue, fake users, fake epochs) that were visually indistinguishable
// from live data. The founder makes decisions off these screens, so an
// invented "$85 USDT revenue" reads as real money. These two primitives make
// the data's provenance impossible to miss:
//   • SampleDataBanner — flags a page/section whose numbers are NOT live.
//   • DataScopeBadge    — on live money surfaces, states whether founder/test
//                         data is included. Defaults to EXCLUDED.

import { AlertTriangle, ShieldCheck } from "lucide-react";

/**
 * Unmissable banner for any page/section still rendering placeholder (non-live)
 * data. Kept deliberately loud — this is a correctness signal, not decoration.
 */
export function SampleDataBanner({ note }: { note?: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div className="space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
          Sample data — not live
        </p>
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          {note ??
            "The figures on this page are placeholder values, not queried from production. Do not use them for decisions."}
        </p>
      </div>
    </div>
  );
}

/**
 * Badge for live money surfaces declaring whether founder/test data is counted.
 * Defaults to excluded — the safe reading for revenue decisions.
 */
export function DataScopeBadge({
  included = false,
  testCount,
}: {
  included?: boolean;
  testCount?: number | null;
}) {
  if (included) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300">
        <AlertTriangle className="h-3 w-3" />
        Founder/test data INCLUDED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
      <ShieldCheck className="h-3 w-3" />
      Founder/test data EXCLUDED
      {typeof testCount === "number" && testCount > 0 ? (
        <span className="font-mono text-emerald-400/70">· {testCount} test rows hidden</span>
      ) : null}
    </span>
  );
}
