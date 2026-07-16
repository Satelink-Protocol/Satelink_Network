"use client";

import { useEffect, useState } from "react";
import { CircleDollarSign, CalendarDays, TrendingUp, Receipt } from "lucide-react";
import { KPIGrid, StatCard, DashboardSection, DataTable, type DataTableColumn } from "@satelink/ui";
import { DataScopeBadge } from "../_components/DataScope";
import { adminGet } from "../_lib/adminClient";

interface RevenueSummary {
  total_real_usdt: number;
  today_usdt: number;
  mtd_usdt: number;
  real_data_count: number;
  is_test_data_count: number;
}

interface PayingCustomer {
  wallet: string;
  credits_usdt: number;
  total_deposited: number;
  total_spent: number;
  created_at: string | number | null;
}

const num = (v: unknown) => Number(v) || 0;

const cols: DataTableColumn<PayingCustomer>[] = [
  {
    key: "wallet",
    header: "Wallet",
    cell: (r) => (
      <span className="font-mono text-xs text-foreground select-all">
        {r.wallet ? `${r.wallet.slice(0, 10)}…${r.wallet.slice(-6)}` : "—"}
      </span>
    ),
  },
  {
    key: "total_deposited",
    header: "Deposited",
    align: "right",
    cell: (r) => <span className="font-mono text-xs text-emerald-400">${num(r.total_deposited).toFixed(4)}</span>,
  },
  {
    key: "total_spent",
    header: "Spent",
    align: "right",
    cell: (r) => <span className="font-mono text-xs text-muted-foreground">${num(r.total_spent).toFixed(4)}</span>,
  },
  {
    key: "credits_usdt",
    header: "Credit Balance",
    align: "right",
    cell: (r) => <span className="font-mono text-xs text-foreground">${num(r.credits_usdt).toFixed(4)}</span>,
  },
];

export default function AdminRevenuePage() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [customers, setCustomers] = useState<PayingCustomer[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminGet<RevenueSummary>("revenue/summary"),
      adminGet<{ paying: PayingCustomer[] }>("customers/list"),
    ])
      .then(([s, c]) => {
        setSummary(s);
        setCustomers(c?.paying ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-end">
        <DataScopeBadge included={false} testCount={summary?.is_test_data_count ?? null} />
      </div>

      <KPIGrid columns={4}>
        <StatCard
          label="Total Revenue (real)"
          value={summary != null ? `$${num(summary.total_real_usdt).toFixed(4)}` : "—"}
          caption="All-time, founder/test excluded"
          icon={CircleDollarSign}
          accent
          loading={loading}
        />
        <StatCard
          label="Today"
          value={summary != null ? `$${num(summary.today_usdt).toFixed(4)}` : "—"}
          caption="Billed since 00:00 UTC"
          icon={CalendarDays}
          loading={loading}
        />
        <StatCard
          label="Month to Date"
          value={summary != null ? `$${num(summary.mtd_usdt).toFixed(4)}` : "—"}
          caption="Billed this month"
          icon={TrendingUp}
          loading={loading}
        />
        <StatCard
          label="Real Revenue Events"
          value={summary != null ? num(summary.real_data_count).toLocaleString() : "—"}
          caption={summary != null ? `${num(summary.is_test_data_count).toLocaleString()} test events excluded` : undefined}
          icon={Receipt}
          loading={loading}
        />
      </KPIGrid>

      <DashboardSection
        title="Paying Customers"
        description="Accounts with an on-chain USDT deposit (from api_credits)"
        flush
      >
        <DataTable
          columns={cols}
          rows={customers}
          rowKey={(r) => r.wallet}
          loading={loading}
          emptyTitle="No paying customers yet"
          emptyDescription="No account has made a USDT deposit. Real paid conversion is still zero — this table populates on the first external deposit."
        />
      </DashboardSection>
    </div>
  );
}
