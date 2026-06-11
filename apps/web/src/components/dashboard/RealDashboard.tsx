'use client';

/**
 * RealDashboard — every number comes from a live API response or is
 * explicitly labeled as static. Metered (unbilled) revenue is never
 * presented as collected revenue. Failed fetches render an explicit
 * "Unable to load — <endpoint>" state, never a blank widget.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Fetched<T> = {
  data: T | null;
  error: string | null;
  fetchedAt: string | null;
};

function useEndpoint<T>(path: string): Fetched<T> {
  const [state, setState] = useState<Fetched<T>>({ data: null, error: null, fetchedAt: null });

  useEffect(() => {
    let cancelled = false;
    fetch(path, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setState({ data, error: null, fetchedAt: new Date().toLocaleTimeString() });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, error: path, fetchedAt: new Date().toLocaleTimeString() });
      });
    return () => { cancelled = true; };
  }, [path]);

  return state;
}

function LoadError({ endpoint }: { endpoint: string }) {
  return (
    <p className="text-sm text-red-400">
      Unable to load — <span className="font-mono">{endpoint}</span>
    </p>
  );
}

function FetchedAt({ at }: { at: string | null }) {
  if (!at) return null;
  return <p className="mt-2 text-xs text-slate-500">Fetched {at}</p>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 truncate font-mono text-xl text-slate-100">{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-slate-800 bg-slate-900/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ── Section 1: System Health — GET /rpc/health ──────────────────────

type RpcHealth = {
  summary?: { healthy: number; unhealthy: number; total: number; healthPercent: string };
};

function SystemHealth() {
  const { data, error, fetchedAt } = useEndpoint<RpcHealth>('/rpc/health');
  return (
    <Section title="System Health">
      {error && <LoadError endpoint="/rpc/health" />}
      {!error && !data && <p className="text-sm text-slate-500">Loading…</p>}
      {data?.summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric label="Providers healthy" value={`${data.summary.healthy}/${data.summary.total}`} />
          <Metric label="Unhealthy" value={String(data.summary.unhealthy)} />
          <Metric label="Health" value={data.summary.healthPercent} />
        </div>
      )}
      <FetchedAt at={fetchedAt} />
    </Section>
  );
}

// ── Section 2: Network Status — GET /api/status ─────────────────────

type ApiStatus = {
  status: string;
  uptime_pct: number;
  nodes_online: number;
  current_epoch: number;
  total_requests_24h: number;
  avg_latency_ms: number;
  chains_supported: string[];
};

function NetworkStatus() {
  const { data, error, fetchedAt } = useEndpoint<ApiStatus>('/api/status');
  return (
    <Section title="Network Status">
      {error && <LoadError endpoint="/api/status" />}
      {!error && !data && <p className="text-sm text-slate-500">Loading…</p>}
      {data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric label="Uptime" value={`${data.uptime_pct}%`} />
          <Metric label="Current epoch" value={String(data.current_epoch)} />
          <Metric label="Requests (24h)" value={data.total_requests_24h.toLocaleString()} />
          <Metric label="Avg latency" value={`${data.avg_latency_ms} ms`} />
          <Metric
            label="Nodes online"
            value={String(data.nodes_online)}
            note={data.nodes_online === 0 ? 'Node agent offline' : undefined}
          />
          <Metric label="Chains" value={String(data.chains_supported.length)} note={data.chains_supported.join(', ')} />
        </div>
      )}
      <FetchedAt at={fetchedAt} />
    </Section>
  );
}

// ── Section 3: Treasury — on-chain truth only ────────────────────────

type TreasuryStatus = {
  vault_address: string;
  vault_balance_usdt: number | null;
  total_deposited_usdt: number;
  active_wallets: number;
};

type SettlementHistory = {
  epochs: Array<{
    id: number;
    status: string;
    totalRevenue: string;
    txHash: string | null;
    closedAt: string | null;
  }>;
};

function Treasury() {
  const treasury = useEndpoint<TreasuryStatus>('/api/treasury/status');
  const history = useEndpoint<SettlementHistory>('/api/settlement/history');

  const epochs = history.data?.epochs ?? [];
  const closed = epochs.filter((e) => e.status === 'CLOSED').length;
  const settled = epochs.filter((e) => e.txHash).length;
  const meteredSum = epochs.reduce((s, e) => s + (parseFloat(e.totalRevenue) || 0), 0);

  return (
    <Section title="Treasury (on-chain truth)">
      {treasury.error && <LoadError endpoint="/api/treasury/status" />}
      {treasury.data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric
            label="Vault balance — Collected (on-chain)"
            value={treasury.data.vault_balance_usdt === null ? 'unavailable' : `${treasury.data.vault_balance_usdt} USDT`}
            note={treasury.data.vault_address}
          />
          <Metric
            label="Deposited by customers — Collected (on-chain)"
            value={`${treasury.data.total_deposited_usdt} USDT`}
            note={`${treasury.data.active_wallets} active wallet(s)`}
          />
          <Metric
            label="External revenue collected"
            value={`${treasury.data.total_deposited_usdt} USDT`}
            note="On-chain deposits only — not metered usage"
          />
        </div>
      )}
      <div className="mt-4 border-t border-slate-800 pt-4">
        {history.error && <LoadError endpoint="/api/settlement/history" />}
        {history.data && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="Epochs closed (recent window)" value={String(closed)} />
            <Metric
              label="Epochs settled on-chain"
              value={String(settled)}
              note={settled === 0 ? 'No tx_hash on any epoch' : undefined}
            />
            <Metric
              label="Metered (unbilled)"
              value={`${meteredSum.toFixed(6)} USDT`}
              note="Usage-metered, never collected — NOT revenue"
            />
          </div>
        )}
      </div>
      <FetchedAt at={treasury.fetchedAt} />
    </Section>
  );
}

// ── Section 4: Free Tier Monitor — GET /system/free-tier ────────────

type FreeTier = { activeIPs: number; totalCalls: number; limit: number };

function FreeTierMonitor() {
  const { data, error, fetchedAt } = useEndpoint<FreeTier>('/system/free-tier');
  return (
    <Section title="Free Tier Monitor">
      {error && <LoadError endpoint="/system/free-tier" />}
      {!error && !data && <p className="text-sm text-slate-500">Loading…</p>}
      {data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric label="Active IPs (24h)" value={data.activeIPs.toLocaleString()} />
          <Metric label="Calls tracked" value={data.totalCalls.toLocaleString()} />
          <Metric label="Daily limit / IP" value={String(data.limit)} />
        </div>
      )}
      <FetchedAt at={fetchedAt} />
    </Section>
  );
}

// ── Section 5: Chainlist Status — static, hard-coded by design ──────

function ChainlistStatus() {
  return (
    <Section title="Chainlist Status (static)">
      <ul className="space-y-2 text-sm text-slate-300">
        <li className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-amber-600 text-amber-400">Pending review</Badge>
          <span>PR #8314: ethereum-lists/chains (reviewer: ligi)</span>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-amber-600 text-amber-400">Pending</Badge>
          <span>PR #2824: chainlist.org</span>
        </li>
      </ul>
      <p className="mt-3 text-xs text-slate-500">Merge unlocks ~395x traffic growth</p>
    </Section>
  );
}

// ── Section 6: Recent Activity — GET /api/settlement/history ────────

function RecentActivity() {
  const { data, error, fetchedAt } = useEndpoint<SettlementHistory>('/api/settlement/history');
  const recent = (data?.epochs ?? []).slice(0, 5);
  return (
    <Section title="Recent Activity">
      {error && <LoadError endpoint="/api/settlement/history" />}
      {!error && !data && <p className="text-sm text-slate-500">Loading…</p>}
      {recent.length > 0 && (
        <ul className="divide-y divide-slate-800">
          {recent.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="font-mono text-slate-300">Epoch {e.id}</span>
              <span className="font-mono text-slate-400">{parseFloat(e.totalRevenue).toFixed(6)} USDT metered</span>
              {e.txHash ? (
                <Badge className="bg-emerald-900 text-emerald-300">settled</Badge>
              ) : (
                <Badge variant="outline" className="border-slate-600 text-slate-400">unsettled</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <FetchedAt at={fetchedAt} />
    </Section>
  );
}

export default function RealDashboard() {
  return (
    <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="pb-2">
          <h1 className="text-xl font-semibold text-slate-100">Satelink Network</h1>
          <p className="text-sm text-slate-500">
            Live operational data. On-chain figures and metered usage are labeled separately.
          </p>
        </header>
        <SystemHealth />
        <NetworkStatus />
        <Treasury />
        <FreeTierMonitor />
        <div className="grid gap-4 lg:grid-cols-2">
          <ChainlistStatus />
          <RecentActivity />
        </div>
      </div>
    </div>
  );
}
