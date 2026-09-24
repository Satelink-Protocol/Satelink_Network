// Console → Usage (web-v3 P6). Per product/metric/key, daily series, CSV export.
// Served by Track B; until then a designed empty state (never "—").
import type { Metadata } from "next";
import { PageHeader, Panel, ConsoleEmpty, PlannedBadge } from "../_components";

export const metadata: Metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <>
      <PageHeader
        title="Usage"
        lede="Calls and spend by product, metric, and key over time."
        action={<span className="inline-flex items-center gap-2 rounded-[var(--sl-radius)] border border-sl-border px-3 py-2 text-sm text-sl-text-muted">Export CSV <PlannedBadge /></span>}
      />
      <Panel title="Daily usage">
        <ConsoleEmpty
          title="No usage yet"
          body="Make your first call and your daily series will appear here — filterable by product, metric, and key, with CSV export."
          cta={{ label: "Make your first call", href: "/console/docs" }}
        />
      </Panel>
    </>
  );
}
