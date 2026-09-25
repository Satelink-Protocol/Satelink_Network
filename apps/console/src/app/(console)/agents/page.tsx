import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateKey } from "@/components/KeyActions";
import { Badge, Empty, PageHeader, Panel, Sparkline, Table } from "@/components/ui";
import { loadKey, series, windowSum } from "@/lib/data";
import { int, usd } from "@/lib/format";
import { fingerprint, getActiveKey, getKeys } from "@/lib/keys";
import Link from "next/link";
import { accountsEnabled } from "@/lib/account";
import { loadKeys, loadSpend, loadUsage } from "@/lib/v2";
import { AccountKeyRow } from "@/components/AccountKeys";
import { Spark } from "@/components/v2/charts";

export const metadata: Metadata = { title: "Agents" };

// An agent is a machine identity = one API key it calls with. Activity per
// agent is that key's real daily usage.
export default async function AgentsPage() {
  if (accountsEnabled()) return <AgentsV2 />;
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

async function AgentsV2() {
  const [keys, usage, spend] = await Promise.all([loadKeys(), loadUsage(30), loadSpend()]);
  const pts = (id: number) => usage.ok ? usage.data.keys.find((k) => k.id === id)?.points.map((p) => p.requests) ?? [] : [];
  const month = (id: number) => (spend.ok ? spend.data.perKey.find((k) => k.id === id)?.monthUsdt ?? 0 : null);
  return (
    <>
      <PageHeader title="Agents" lede="Each agent is a key your software uses. What it may use and how much it may spend are enforced by the API on every call."
        actions={<Link href="/agents/new" className="h-8 rounded bg-sl-accent px-3 py-2 text-xs font-semibold text-sl-accent-ink">Give my software access</Link>} />
      {!keys.ok ? <Empty title="Couldn't load your agents" body="Refresh in a moment." /> : keys.data.length === 0 ? (
        <Empty title="No agents yet" body="Create access for an app, bot or script — you choose what it can use and set a monthly limit." cta={{ label: "Give my software access", href: "/agents/new" }} />
      ) : (
        <>
          {/* Phones: one card per agent, stacked. */}
          <ul className="space-y-2 md:hidden" aria-label="Agents">
            {keys.data.map((k) => (
              <li key={k.id} className="rounded-md border border-sl-border bg-sl-surface p-3">
                <p className="flex items-center justify-between gap-2"><span className="font-medium text-sl-text">{k.label}</span>{k.limits.paused && <Badge tone="warn">paused</Badge>}</p>
                <p className="font-mono text-[11px] text-sl-text-subtle">{k.hint}</p>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-[13px]">
                  <dt className="text-sl-text-muted">Can use</dt><dd>{k.limits.scopes ? k.limits.scopes.map((s) => (s === "intelligence" ? "market data" : "RPC")).join(", ") : "everything"}</dd>
                  <dt className="text-sl-text-muted">Monthly limit</dt><dd>{k.limits.monthlyCapUsdt === null || k.limits.monthlyCapUsdt === undefined ? "no limit" : `$${k.limits.monthlyCapUsdt}`}</dd>
                  <dt className="text-sl-text-muted">This month</dt><dd className="tnum">{month(k.id) === null ? "" : usd(month(k.id) as number, 4)}</dd>
                  <dt className="text-sl-text-muted">Credits</dt><dd className="tnum">{usd(k.balanceUsdt, 4)}</dd>
                </dl>
                <Link href="/keys" className="mt-2 inline-block text-[13px] text-sl-accent underline">Pause, limit or rotate</Link>
              </li>
            ))}
          </ul>
          <Panel title={`Agents (${keys.data.length})`} className="hidden md:block">
            <Table head={["Agent", "Can use", "Monthly limit", "This month", "Last 30 days"]} numeric={[3]}>
              {keys.data.map((k) => (
                <tr key={k.id}>
                  <td><span className="text-sl-text">{k.label}</span> <span className="font-mono text-sl-text-subtle">{k.hint}</span>{k.limits.paused && <Badge tone="warn">paused</Badge>}</td>
                  <td>{k.limits.scopes ? k.limits.scopes.map((s) => (s === "intelligence" ? "market data" : "RPC")).join(", ") : "everything"}</td>
                  <td>{k.limits.monthlyCapUsdt === null || k.limits.monthlyCapUsdt === undefined ? <span className="text-sl-text-subtle">no limit</span> : `$${k.limits.monthlyCapUsdt}`}</td>
                  <td className="text-right">{month(k.id) === null ? "" : usd(month(k.id) as number, 4)}</td>
                  <td><Spark values={pts(k.id)} label={`${k.label} requests`} /></td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Manage" className="mt-4 hidden md:block">
            <Table head={["Key", "Name", "Tier", "Credits", "Daily cap", "Last used", ""]} numeric={[3, 4]}>
              {keys.data.map((k) => <AccountKeyRow key={k.id} k={k} />)}
            </Table>
          </Panel>
        </>
      )}
    </>
  );
}
