"use client";

// Shared correctness primitive for the admin dashboard's money surfaces.
//
// WHY THIS EXISTS
// The public /api/revenue* endpoints SUM revenue_events_v2 with no is_test_data
// filter, so founder/test settlements read as real money. Every money surface
// now consumes the test-data-excluding /admin observer endpoints and carries
// this badge so the data's scope is explicit. Defaults to EXCLUDED — the safe
// reading for revenue decisions.

import { AlertTriangle, ShieldCheck } from "lucide-react";

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
