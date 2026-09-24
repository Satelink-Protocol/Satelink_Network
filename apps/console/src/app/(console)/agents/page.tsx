import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateKey } from "@/components/KeyActions";
import { Badge, Empty, PageHeader, Panel, Sparkline, Table } from "@/components/ui";
import { loadKey, series, windowSum } from "@/lib/data";
import { int, usd } from "@/lib/format";
import { fingerprint, getActiveKey, getKeys } from "@/lib/keys";

export const metadata: Metadata = { title: "Agents" };

// An agent is a machine identity = one API key it calls with. Activity per
// agent is that key's real daily usage.
export default async function AgentsPage() {
  const [keys, active] = await Promise.all([getKeys(), getActiveKey()]);
  const agents = await Promise.all(keys.map(async (k) => ({ k, d: await loadKey(k.k) })));

  return (
    <>
      <PageHeader
        title="Agents"
        lede="Each agent is a machine identity with its own API key, usage and spend."
        actions={<Suspense><CreateKey noun="agent" /></Suspense>}
      />
      {agents.length === 0 ? (
        <Empty title="No agents yet" body="Create an agent to issue it a key, then make a test call from the snippet shown." />
      ) : (
        <Panel title="Agents">
          <Table head={["Agent", "Key", "Status", "Calls 7d", "Spend 7d", "Calls 30d", "Trend 14d", "Credits"]} numeric={[3, 4, 5, 7]}>
            {agents.map(({ k, d }) => {
              const days = d.days;
              const calls7 = days ? windowSum(days, 7, "calls") : null;
              return (
                <tr key={k.k}>
                  <td className="font-medium text-sl-text">{k.label} {k.k === active?.k && <Badge tone="good">active</Badge>}</td>
                  <td className="font-mono text-sl-text-muted">{fingerprint(k.k)}</td>
                  <td>{calls7 === null ? <Badge tone="warn">unknown</Badge> : calls7 > 0 ? <Badge tone="good">calling</Badge> : <Badge>idle</Badge>}</td>
                  <td className="text-right">{calls7 === null ? "" : int(calls7)}</td>
                  <td className="text-right">{days ? usd(windowSum(days, 7, "spent"), 5) : ""}</td>
                  <td className="text-right">{days ? int(windowSum(days, 30, "calls")) : ""}</td>
                  <td>{days ? <Sparkline values={series(days, 14, "calls")} /> : null}</td>
                  <td className="text-right">{d.summary ? usd(d.summary.balanceUsd, 4) : ""}</td>
                </tr>
              );
            })}
          </Table>
        </Panel>
      )}
      <Panel title="Per-agent controls" className="mt-4">
        <Empty
          title="Scopes, spend caps, pause and rotate are coming"
          body="These need agents to be stored server-side against your account. Until then, limits come from each key's tier, and a key is stopped by disconnecting it and no longer using it."
        />
      </Panel>
    </>
  );
}
