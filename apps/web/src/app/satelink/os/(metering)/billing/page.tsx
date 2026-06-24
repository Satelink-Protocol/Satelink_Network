"use client";

import { useState, useEffect, useCallback } from "react";
import { Wallet, Hourglass, CreditCard, CalendarDays, CalendarRange, Calendar } from "lucide-react";
import {
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  StatusBadge,
  AsyncBoundary,
  Badge,
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
import { KeySelector, NoKeyState } from "@/components/billing/shared";

interface UsageDay {
  date: string;
  request_count: number;
  usdt_spent: number;
}

interface LedgerRow {
  ts: number;
  when: string;
  type: "Deposit" | "Deduction";
  detail: string;
  delta: number; // signed USDT
}

interface RevenueRow {
  when: string;
  operation: string;
  deducted: number;
  balanceAfter: number;
}

function parseDay(d: string): number {
  const t = Date.parse(d);
  return Number.isNaN(t) ? 0 : t;
}
function depTs(d: DepositRecord): number {
  const n = Number(d.created_at);
  if (n) return n > 1e12 ? n : n * 1000;
  return parseDay(d.created_at);
}

export default function BillingPage() {
  const { keys, selected, setSelected, ready } = useApiKeys();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [info, setInfo] = useState<DepositInfo | null>(null);
  const [usage, setUsage] = useState<UsageDay[]>([]);
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
        keyFetch<DepositInfo>("/api/keys/deposit-info", key),
        keyFetch<{ usage: UsageDay[] }>("/api/keys/usage-history", key).catch(() => ({ usage: [] })),
        keyFetch<{ deposits: DepositRecord[] }>("/api/keys/deposits", key).catch(() => ({ deposits: [] })),
      ]);
      setSummary(s);
      setInfo(i);
      setUsage(u.usage || []);
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

  if (ready && keys.length === 0) return <NoKeyState context="view your balance and billing" />;

  const now = Date.now();
  const within = (days: number) =>
    usage.filter((u) => now - parseDay(u.date) <= days * 86400_000).reduce((a, u) => a + Number(u.usdt_spent || 0), 0);
  const spentToday = summary?.usdt_spent_today ?? 0;
  const spentWeek = within(7);
  const spentMonth = within(30);

  const creditsRemaining = summary?.credits_remaining ?? 0;
  const totalDeposited = info?.total_deposited ?? 0;

  // Revenue events: daily deductions with an estimated running balance-after.
  const sortedDesc = [...usage].sort((a, b) => parseDay(b.date) - parseDay(a.date));
  let running = creditsRemaining;
  const revenueRows: RevenueRow[] = sortedDesc
    .filter((u) => Number(u.usdt_spent || 0) > 0 || Number(u.request_count || 0) > 0)
    .map((u) => {
      const deducted = Number(u.usdt_spent || 0);
      const row: RevenueRow = {
        when: new Date(parseDay(u.date)).toLocaleDateString(),
        operation: `${Number(u.request_count || 0).toLocaleString()} RPC calls`,
        deducted,
        balanceAfter: running,
      };
      running += deducted;
      return row;
    });

  // Credit history: deposits (+) and daily deductions (−), chronological.
  const ledger: LedgerRow[] = [
    ...deposits.map((d) => ({ ts: depTs(d), when: new Date(depTs(d)).toLocaleString(), type: "Deposit" as const, detail: `${d.tx_hash.substring(0, 12)}…`, delta: parseFloat(d.amount_usdt) })),
    ...usage.filter((u) => Number(u.usdt_spent || 0) > 0).map((u) => ({ ts: parseDay(u.date), when: new Date(parseDay(u.date)).toLocaleDateString(), type: "Deduction" as const, detail: `${Number(u.request_count || 0).toLocaleString()} calls`, delta: -Number(u.usdt_spent || 0) })),
  ].sort((a, b) => b.ts - a.ts);

  const revenueCols: DataTableColumn<RevenueRow>[] = [
    { key: "when", header: "Timestamp", cell: (r) => <span className="text-xs">{r.when}</span> },
    { key: "op", header: "Operation", cell: (r) => <span className="text-xs">{r.operation}</span> },
    { key: "deducted", header: "Credits Deducted", align: "right", cell: (r) => <span className="font-mono text-xs text-destructive">-${r.deducted.toFixed(5)}</span> },
    { key: "after", header: "Balance After (est.)", align: "right", cell: (r) => <span className="font-mono text-xs">${r.balanceAfter.toFixed(5)}</span> },
  ];

  const ledgerCols: DataTableColumn<LedgerRow>[] = [
    { key: "when", header: "When", cell: (r) => <span className="text-xs">{r.when}</span> },
    { key: "type", header: "Type", cell: (r) => <StatusBadge status={r.type === "Deposit" ? "confirmed" : "pending"} label={r.type} /> },
    { key: "detail", header: "Detail", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.detail}</span> },
    { key: "delta", header: "Amount", align: "right", cell: (r) => <span className={"font-mono text-xs " + (r.delta >= 0 ? "text-success" : "text-destructive")}>{r.delta >= 0 ? "+" : "-"}${Math.abs(r.delta).toFixed(5)}</span> },
  ];

  return (
    <div className="space-y-6">
      <KeySelector keys={keys} selected={selected} onSelect={setSelected} />

      {/* Current Balance */}
      <DashboardSection title="Current Balance" description="spendable credits, pending funding and lifetime deposits" card={false}>
        <KPIGrid columns={3}>
          <StatCard label="Available Credits" icon={Wallet} accent loading={loading && !summary} value={`$${creditsRemaining.toFixed(5)}`} caption={`≈ ${Math.round(creditsRemaining / PRICE_PER_CALL).toLocaleString()} calls`} />
          <StatCard label="Pending Credits" icon={Hourglass} value="$0.00000" caption="no unconfirmed deposits" />
          <StatCard label="Total Deposited" icon={CreditCard} loading={loading && !info} value={`$${totalDeposited.toFixed(2)}`} caption="USDT lifetime" />
        </KPIGrid>
      </DashboardSection>

      {/* Consumption */}
      <DashboardSection title="Consumption" description="metered spend over time" card={false}>
        <KPIGrid columns={3}>
          <StatCard label="Today" icon={CalendarDays} loading={loading && !summary} value={`$${spentToday.toFixed(5)}`} caption={`${summary?.requests_today ?? 0} calls`} />
          <StatCard label="This Week" icon={CalendarRange} loading={loading} value={`$${spentWeek.toFixed(5)}`} caption="last 7 days" />
          <StatCard label="This Month" icon={Calendar} loading={loading} value={`$${spentMonth.toFixed(5)}`} caption="last 30 days" />
        </KPIGrid>
      </DashboardSection>

      {/* Revenue Events */}
      <DashboardSection title="Revenue Events" description="per-day metered deductions with running balance" actions={<Badge variant="outline">{revenueRows.length}</Badge>} flush>
        <div className="px-2">
          <AsyncBoundary loading={loading && revenueRows.length === 0} error={error} isEmpty={!loading && revenueRows.length === 0}
            emptyTitle="No billed activity yet"
            emptyDescription="Once your key makes billable requests, each day's deductions appear here."
            emptyAction={<span className="text-[11px] text-muted-foreground">Next: make a request from the Keys page.</span>}
            onRetry={() => load(selected)}>
            <DataTable columns={revenueCols} rows={revenueRows} rowKey={(r) => r.when + r.deducted} />
          </AsyncBoundary>
        </div>
      </DashboardSection>

      {/* Credit History */}
      <DashboardSection title="Credit History" description="deposits and deductions (adjustments shown when issued)" flush>
        <div className="px-2">
          <AsyncBoundary loading={loading && ledger.length === 0} error={error} isEmpty={!loading && ledger.length === 0}
            emptyTitle="No credit history yet"
            emptyDescription="Your deposits and deductions will be listed here as a single ledger."
            emptyAction={<span className="text-[11px] text-muted-foreground">Next: fund credits on the Deposit page.</span>}
            onRetry={() => load(selected)}>
            <DataTable columns={ledgerCols} rows={ledger} rowKey={(r) => r.type + r.ts + r.delta} />
          </AsyncBoundary>
        </div>
      </DashboardSection>
    </div>
  );
}
