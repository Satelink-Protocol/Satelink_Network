"use client";

import {
  Wallet,
  Hourglass,
  CreditCard,
  Coins,
  BarChart3,
  RefreshCw,
  Database,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import {
  DashboardSection,
  KPIGrid,
  StatCard,
  DataTable,
  StatusBadge,
  Badge,
  Button,
  useEndpoint,
} from "@satelink/ui";

interface FinancialTruth {
  ok: boolean;
  timestamp: string;
  query_ms: number;
  metered_value_usdt: number;
  allocated_value_usdt: number;
  unpaid_value_usdt: number;
  treasury_real_usdt: number;
  withdrawable_now_usdt: number;
  claimed_total_usdt: number;
  cash_conversion_pct: number;
  status: string;
  warnings: {
    code: string;
    message: string;
    severity: "critical" | "warning";
  }[];
}

interface EconomicsSummary {
  ok: boolean;
  totalRevenueUsdt: number;
  totalNodePoolUsdt: number;
  totalPlatformShareUsdt: number;
  totalDistributorShareUsdt: number;
  splitRatio: {
    nodeOperators: number;
    platform: number;
    distributors: number;
  };
  lastEpochId: number;
  lastEpochRevenueUsdt: number;
  lastEpochClosedAt: string | null;
}

interface TreasuryStatus {
  ok: boolean;
  vault_address: string;
  vault_balance_usdt: number | null;
  total_deposited_usdt: number;
  active_wallets: number;
  network: string;
  timestamp: string;
}

interface RevenueEventItem {
  id: number;
  amount_usdt: string;
  created_at: string;
}

interface RevenueEventsResponse {
  ok: boolean;
  events: RevenueEventItem[];
}

interface EpochItem {
  epoch_id: number;
  status: string;
  starts_at: string;
  ends_at: string | null;
  total: string;
  node_pool_usdt: string;
  platform_share_usdt: string;
  distributor_share_usdt: string;
  requests: string;
}

interface EpochsResponse {
  ok: boolean;
  epochs: EpochItem[];
}

const formatTs = (ts: any) => {
  if (!ts) return "—";
  const num = Number(ts);
  return new Date(num * 1000).toLocaleString();
};

export default function BillingPage() {
  const financial = useEndpoint<FinancialTruth>(["/api/financial/truth"]);
  const econ = useEndpoint<EconomicsSummary>(["/api/economics/summary"]);
  const treasury = useEndpoint<TreasuryStatus>(["/api/treasury/status"]);
  const revEvents = useEndpoint<RevenueEventsResponse>(["/api/revenue/events"]);
  const epochs = useEndpoint<EpochsResponse>(["/api/epochs"]);

  const reloadAll = () => {
    financial.reload();
    econ.reload();
    treasury.reload();
    revEvents.reload();
    epochs.reload();
  };

  const billedValue = financial.data?.metered_value_usdt ?? 0;
  const collectedValue = treasury.data?.total_deposited_usdt ?? 0;
  const unpaidValue = financial.data?.unpaid_value_usdt ?? 0;
  const claimableValue = financial.data?.withdrawable_now_usdt ?? 0;
  const withdrawnValue = financial.data?.claimed_total_usdt ?? 0;

  const eventCols = [
    {
      key: "id",
      header: "Event ID",
      cell: (r: RevenueEventItem) => <span className="font-mono text-xs text-muted-foreground">{r.id}</span>,
    },
    {
      key: "created_at",
      header: "Timestamp",
      cell: (r: RevenueEventItem) => <span className="text-xs">{formatTs(r.created_at)}</span>,
    },
    {
      key: "amount_usdt",
      header: "Amount (USDT)",
      align: "right" as const,
      cell: (r: RevenueEventItem) => (
        <span className="font-mono text-xs font-bold text-emerald-400">
          ${parseFloat(r.amount_usdt).toFixed(6)}
        </span>
      ),
    },
  ];

  const epochCols = [
    {
      key: "epoch_id",
      header: "Epoch ID",
      cell: (r: EpochItem) => <span className="font-mono text-xs font-semibold text-foreground">Epoch {r.epoch_id}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r: EpochItem) => (
        <StatusBadge status={r.status === "CLOSED" ? "confirmed" : "pending"} label={r.status} />
      ),
    },
    {
      key: "starts_at",
      header: "Start Time",
      cell: (r: EpochItem) => <span className="text-[11px] text-muted-foreground">{formatTs(r.starts_at)}</span>,
    },
    {
      key: "ends_at",
      header: "End Time",
      cell: (r: EpochItem) => <span className="text-[11px] text-muted-foreground">{formatTs(r.ends_at)}</span>,
    },
    {
      key: "requests",
      header: "RPC Calls",
      cell: (r: EpochItem) => <span className="font-mono text-xs">{Number(r.requests || 0).toLocaleString()}</span>,
    },
    {
      key: "total",
      header: "Revenue",
      align: "right" as const,
      cell: (r: EpochItem) => <span className="font-mono text-xs text-foreground">${parseFloat(r.total).toFixed(4)}</span>,
    },
    {
      key: "node_pool_usdt",
      header: "Node Share",
      align: "right" as const,
      cell: (r: EpochItem) => <span className="font-mono text-xs text-red-400">${parseFloat(r.node_pool_usdt).toFixed(4)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header Actions */}
      <div className="flex justify-between items-center border-b border-border pb-4">
        <div>
          <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Operator Billing Panel</span>
          <h2 className="text-sm font-bold text-foreground">Platform Ledger & Vault Metrics</h2>
        </div>
        <Button size="sm" variant="outline" onClick={reloadAll}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reload Data
        </Button>
      </div>

      {/* KPI metrics answering the core billing questions */}
      <KPIGrid columns={5}>
        <StatCard
          label="Billed (Metered)"
          value={`$${billedValue.toFixed(5)} USDT`}
          icon={BarChart3}
          caption="Gross query volume billed"
          loading={financial.loading}
        />
        <StatCard
          label="Collected (Deposited)"
          value={`$${collectedValue.toFixed(2)} USDT`}
          icon={Wallet}
          caption="Total funded by customers"
          loading={treasury.loading}
          accent
        />
        <StatCard
          label="Unpaid Payouts"
          value={`$${unpaidValue.toFixed(5)} USDT`}
          icon={Hourglass}
          caption="Epoch rewards owed to nodes"
          loading={financial.loading}
        />
        <StatCard
          label="Claimable Yield"
          value={`$${claimableValue.toFixed(5)} USDT`}
          icon={Coins}
          caption="Allocated ready-to-claim payouts"
          loading={financial.loading}
          accent={claimableValue > 0}
        />
        <StatCard
          label="Withdrawn (Claimed)"
          value={`$${withdrawnValue.toFixed(5)} USDT`}
          icon={CreditCard}
          caption="Total payouts withdrawn to wallets"
          loading={financial.loading}
        />
      </KPIGrid>

      {/* platform treasury & split rules */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* On-Chain Vault Details */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">On-Chain Vault Details</h3>
            <p className="text-[11px] text-muted-foreground">EVM smart contract storage state</p>
          </div>
          
          <div className="space-y-3 font-mono text-xs">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Vault Address:</span>
              <span className="text-foreground truncate max-w-[200px] select-all">
                {treasury.data?.vault_address || "0x80AF...DdA3"}
              </span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Vault Balance:</span>
              <span className="text-emerald-400 font-bold">
                {treasury.data?.vault_balance_usdt !== null && treasury.data?.vault_balance_usdt !== undefined
                  ? `$${parseFloat(String(treasury.data.vault_balance_usdt)).toFixed(4)} USDT`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Active Customers (Depositors):</span>
              <span className="text-foreground font-bold">
                {treasury.data?.active_wallets ?? 0} accounts
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">USDT Contract:</span>
              <span className="text-slate-400 select-all truncate max-w-[200px]">
                0xc2132D05D31c914a87C6611C10748AEb04B58e8F
              </span>
            </div>
          </div>
        </div>

        {/* Platform Share Policies */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">USDT Top-Level Share Metrics</h3>
            <p className="text-[11px] text-muted-foreground">Total accumulated allocations across settled epochs</p>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Node Operators Allocation:</span>
              <span className="text-slate-200 font-bold">
                ${(econ.data?.totalNodePoolUsdt ?? 0).toFixed(4)} USDT (50.0%)
              </span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Platform Core Allocation:</span>
              <span className="text-slate-200 font-bold">
                ${(econ.data?.totalPlatformShareUsdt ?? 0).toFixed(4)} USDT (30.0%)
              </span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Distributors Allocation:</span>
              <span className="text-slate-200 font-bold">
                ${(econ.data?.totalDistributorShareUsdt ?? 0).toFixed(4)} USDT (20.0%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Allocated Total (All Epochs):</span>
              <span className="text-emerald-400 font-bold">
                ${(econ.data?.totalRevenueUsdt ?? 0).toFixed(4)} USDT
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Epochs Ledger Section */}
      <DashboardSection
        title="Historical Epoch Ledger"
        description="Platforms aggregated settled epochs and node reward shares"
        actions={<Badge variant="outline">{(epochs.data?.epochs ?? []).length} settled epochs</Badge>}
        flush
      >
        <DataTable
          columns={epochCols}
          rows={epochs.data?.epochs ?? []}
          rowKey={(r) => r.epoch_id}
          loading={epochs.loading}
        />
      </DashboardSection>

      {/* Recent Billed Revenue Events */}
      <DashboardSection
        title="Recent Billed Revenue Events"
        description="Metered RPC query billing entries recorded in database ledger"
        actions={<Badge variant="outline">{(revEvents.data?.events ?? []).length} records</Badge>}
        flush
      >
        <DataTable
          columns={eventCols}
          rows={revEvents.data?.events ?? []}
          rowKey={(r) => r.id}
          loading={revEvents.loading}
        />
      </DashboardSection>
    </div>
  );
}
