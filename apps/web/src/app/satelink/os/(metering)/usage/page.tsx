"use client";

import { useState, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Activity, CircleDollarSign, Zap, Receipt } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  KPICard,
  DashboardSection,
  DataTable,
  StatusBadge,
  EmptyState,
  AsyncBoundary,
  type DataTableColumn,
} from "@satelink/ui";
import {
  useApiKeys,
  keyFetch,
  PRICE_PER_CALL,
  type UsageSummary,
  type DepositInfo,
  type DepositRecord,
} from "@/lib/api-keys";
import { KeySelector, NoKeyState, InsufficientBalance } from "@/components/billing/shared";

interface UsageDay {
  date: string;
  request_count: number;
  usdt_spent: number;
}

export default function UsagePage() {
  const { keys, selected, setSelected, ready } = useApiKeys();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [info, setInfo] = useState<DepositInfo | null>(null);
  const [history, setHistory] = useState<UsageDay[]>([]);
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (key: string) => {
    if (!key) return;
    setLoading(true);
    setError(null);
    try {
      const [s, i, u, d] = await Promise.all([
        keyFetch<UsageSummary>("/api/keys/usage", key),
        keyFetch<DepositInfo>("/api/keys/deposit-info", key).catch(() => null),
        keyFetch<{ usage: UsageDay[] }>("/api/keys/usage-history", key).catch(() => ({ usage: [] })),
        keyFetch<{ deposits: DepositRecord[] }>("/api/keys/deposits", key).catch(() => ({ deposits: [] })),
      ]);
      setSummary(s);
      setInfo(i);
      setHistory(u.usage || []);
      setDeposits(d.deposits || []);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) load(selected);
  }, [selected, load]);

  if (ready && keys.length === 0) return <NoKeyState context="see your request usage and costs" />;

  const series = history
    .map((h) => ({
      date: h.date ? new Date(h.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
      calls: Number(h.request_count || 0),
      cost: parseFloat(String(h.usdt_spent || 0)),
    }))
    .reverse();

  const totalRequests = history.reduce((a, h) => a + Number(h.request_count || 0), 0);
  const creditsConsumed = summary?.total_spent_usdt ?? 0;
  const billableRequests = Math.round(creditsConsumed / PRICE_PER_CALL);
  const avgCost = totalRequests > 0 ? creditsConsumed / totalRequests : 0;
  const creditsRemaining = summary?.credits_remaining ?? 0;

  const usageCols: DataTableColumn<UsageDay>[] = [
    { key: "date", header: "Date", cell: (i) => <span className="text-xs">{new Date(i.date).toLocaleDateString()}</span> },
    { key: "count", header: "Requests", align: "right", cell: (i) => <span className="font-mono text-xs">{Number(i.request_count).toLocaleString()}</span> },
    { key: "cost", header: "Cost (USDT)", align: "right", cell: (i) => <span className="font-mono text-xs">${parseFloat(String(i.usdt_spent)).toFixed(6)}</span> },
  ];

  const depCols: DataTableColumn<DepositRecord>[] = [
    { key: "tx", header: "Transaction", cell: (i) => <a href={`https://polygonscan.com/tx/${i.tx_hash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">{i.tx_hash.substring(0, 16)}…</a> },
    { key: "amount", header: "Amount", align: "right", cell: (i) => <span className="font-mono text-xs">${parseFloat(i.amount_usdt).toFixed(2)}</span> },
    { key: "status", header: "Status", cell: () => <StatusBadge status="confirmed" /> },
  ];

  return (
    <div className="space-y-6">
      <KeySelector keys={keys} selected={selected} onSelect={setSelected} />

      {info && creditsRemaining <= 0 && creditsConsumed > 0 && (
        <InsufficientBalance balance={creditsRemaining} vaultAddress={info.deposit.address} onRetry={() => load(selected)} />
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Requests" icon={Activity} value={totalRequests.toLocaleString()} caption={`${summary?.requests_today ?? 0} today`} />
        <KPICard label="Billable Requests" icon={Receipt} value={billableRequests.toLocaleString()} caption="metered (cost > 0)" />
        <KPICard label="Credits Consumed" icon={CircleDollarSign} value={`$${creditsConsumed.toFixed(5)}`} caption="lifetime spend" />
        <KPICard label="Avg Cost / Request" icon={Zap} value={`$${avgCost.toFixed(6)}`} caption={`base $${PRICE_PER_CALL}/call`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Usage timeline */}
        <Card>
          <CardHeader>
            <CardTitle>Usage Timeline</CardTitle>
            <CardDescription>Requests per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <AsyncBoundary loading={loading} error={error} isEmpty={!loading && series.length === 0} loadingVariant="block"
              emptyTitle="No usage recorded yet" emptyDescription="Send requests through the gateway to populate this chart." onRetry={() => load(selected)}>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs><linearGradient id="uCalls" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12, borderRadius: 6 }} />
                    <Area type="monotone" dataKey="calls" name="Requests" stroke="var(--primary)" strokeWidth={1.5} fill="url(#uCalls)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </AsyncBoundary>
          </CardContent>
        </Card>

        {/* Cost timeline */}
        <Card>
          <CardHeader>
            <CardTitle>Cost Timeline</CardTitle>
            <CardDescription>USDT spent per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <AsyncBoundary loading={loading} error={error} isEmpty={!loading && series.length === 0} loadingVariant="block"
              emptyTitle="No spend recorded yet" emptyDescription="Billable requests will show their daily cost here." onRetry={() => load(selected)}>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs><linearGradient id="uCost" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--success)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--success)" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12, borderRadius: 6 }} formatter={(v) => [`$${Number(v).toFixed(6)}`, "Cost"]} />
                    <Area type="monotone" dataKey="cost" name="Cost" stroke="var(--success)" strokeWidth={1.5} fill="url(#uCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </AsyncBoundary>
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <DashboardSection title="Daily Usage" flush>
        <div className="px-2">
          <AsyncBoundary loading={loading} error={error} isEmpty={!loading && history.length === 0}
            emptyTitle="No usage history" emptyDescription="Daily request and cost rows will appear once you make requests."
            emptyAction={<span className="text-[11px] text-muted-foreground">Next: copy your key on the Keys page and send a request.</span>} onRetry={() => load(selected)}>
            <DataTable columns={usageCols} rows={history} rowKey={(i) => i.date} />
          </AsyncBoundary>
        </div>
      </DashboardSection>

      <DashboardSection title="Funding & Deposits" flush>
        <div className="px-2">
          <AsyncBoundary loading={loading} error={error} isEmpty={!loading && deposits.length === 0}
            emptyTitle="No deposits yet" emptyDescription="Fund credits to keep requests flowing past the free tier."
            emptyAction={<a href="/satelink/os/deposit" className="text-[11px] text-primary hover:underline">Add credits →</a>} onRetry={() => load(selected)}>
            <DataTable columns={depCols} rows={deposits} rowKey={(i) => i.tx_hash} />
          </AsyncBoundary>
        </div>
      </DashboardSection>
    </div>
  );
}
