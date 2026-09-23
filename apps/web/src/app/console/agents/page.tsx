// Console → Agents & keys (web-v3 P6). API keys presented as named "agents":
// create, label, scope, per-key rate limit + spend cap, rotate, revoke, last
// used. Key management is served by Track B; until then the list is a designed
// empty state and creation carries a Planned badge (no dead control).
import type { Metadata } from "next";
import { PageHeader, Panel, ConsoleEmpty, PlannedBadge } from "../_components";

export const metadata: Metadata = { title: "Agents & keys" };

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Agents & keys"
        lede="Issue an API key per agent, scope it to products, and bound it with a rate limit and spend cap."
        action={
          <span className="inline-flex items-center gap-2 rounded-[var(--sl-radius)] border border-sl-border px-3 py-2 text-sm text-sl-text-muted">
            Create agent key <PlannedBadge />
          </span>
        }
      />
      <Panel title="Your agents">
        <ConsoleEmpty
          title="No agent keys yet"
          body="Create your first key to start calling the API. Each key can be scoped to specific products, rate-limited, given a spend cap, rotated, and revoked."
        />
      </Panel>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          ["Scoped", "Limit a key to Trading Intelligence, RPC, or x402."],
          ["Bounded", "Set a per-key rate limit and spend cap so a runaway agent can't overspend."],
          ["Rotatable", "Rotate or revoke a key instantly if it's exposed."],
        ].map(([t, b]) => (
          <div key={t} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-4">
            <p className="text-sm font-semibold text-sl-text">{t}</p>
            <p className="mt-1 text-sm text-sl-text-muted">{b}</p>
          </div>
        ))}
      </div>
    </>
  );
}
