"use client";

import { useEffect, useState, useMemo } from "react";
import {
  TrendingUp,
  DollarSign,
  Cpu,
  Coins,
  RefreshCw,
  AlertTriangle,
  Play,
  ArrowRight,
  Database,
  Layers,
} from "lucide-react";
import {
  DashboardSection,
  KPICard,
  DataTable,
  StatusBadge,
  Badge,
  Button,
  useEndpoint,
} from "@satelink/ui";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

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

interface EpochItem {
  epoch_id: number;
  status: string;
  starts_at: number;
  ends_at: number | null;
  total: number;
  node_pool_usdt: number;
  platform_share_usdt: number;
  distributor_share_usdt: number;
  requests: number;
}

interface EpochsResponse {
  ok: boolean;
  epochs: EpochItem[];
}

export default function RevenueOpsPage() {
  const financial = useEndpoint<FinancialTruth>(["/api/financial/truth"]);
  const econ = useEndpoint<EconomicsSummary>(["/api/economics/summary"]);
  const epochs = useEndpoint<EpochsResponse>(["/api/epochs"]);

  const [topDevs, setTopDevs] = useState<any[]>([]);
  const [loadingDevs, setLoadingDevs] = useState(true);
  const [triggeringEpoch, setTriggeringEpoch] = useState(false);

  const fetchDevs = () => {
    setLoadingDevs(true);
    fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/intel/developers", method: "GET" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.developers)) {
          setTopDevs(data.developers);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDevs(false));
  };

  const handleTriggerEpoch = async () => {
    if (!window.confirm("Are you sure you want to trigger a manual epoch cycle rollup? This will aggregate and distribute unpaid earnings.")) return;
    setTriggeringEpoch(true);
    try {
      const res = await fetch("/system/epoch-scheduler/trigger", {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        alert("Epoch cycle rollup triggered successfully!");
        financial.reload();
        econ.reload();
        epochs.reload();
      } else {
        alert(`Failed to trigger epoch rollup: ${data.error || "unknown"}`);
      }
    } catch (e: any) {
      alert(`Request failed: ${e.message}`);
    } finally {
      setTriggeringEpoch(false);
    }
  };

  useEffect(() => {
    fetchDevs();
  }, []);

  // Compute waterfall values from real API values
  const totalRev = econ.data?.totalRevenueUsdt || 0;
  const nodePool = econ.data?.totalNodePoolUsdt || 0;
  const platformShare = econ.data?.totalPlatformShareUsdt || 0;
  const distributorShare = econ.data?.totalDistributorShareUsdt || 0;

  // Waterfall dataset (using transparent floating stack bar chart technique)
  // Stack 1 (base): floats the bar.
  // Stack 2 (val): represents the item value.
  const waterfallData = useMemo(() => {
    return [
      { name: "Gross Allocated", base: 0, val: totalRev, fill: "#3b82f6" },
      { name: "Node Operators", base: totalRev - nodePool, val: nodePool, fill: "#ef4444" },
      { name: "Distributor Pool", base: platformShare, val: distributorShare, fill: "#f59e0b" },
      { name: "Platform Share", base: 0, val: platformShare, fill: "#10b981" },
    ];
  }, [totalRev, nodePool, platformShare, distributorShare]);

  // Extract real epoch history for the bar chart
  const epochHistory = useMemo(() => {
    const list = epochs.data?.epochs || [];
    return list.slice().reverse().map((e) => ({
      name: `Epoch ${e.epoch_id}`,
      nodeShare: parseFloat(String(e.node_pool_usdt || 0)),
      distributorShare: parseFloat(String(e.distributor_share_usdt || 0)),
      platformShare: parseFloat(String(e.platform_share_usdt || 0)),
    }));
  }, [epochs.data]);

  const devCols = [
    {
      key: "ip",
      header: "Customer Identifier (IP)",
      cell: (r: any) => <span className="font-mono text-xs font-semibold text-foreground select-all">{r.ip}</span>,
    },
    {
      key: "country",
      header: "Region",
      cell: (r: any) => <span className="text-xs text-muted-foreground">{r.country || "GLOBAL"}</span>,
    },
    {
      key: "calls_today",
      header: "Calls Today",
      cell: (r: any) => <span className="font-mono text-xs text-foreground">{r.calls_today.toLocaleString()}</span>,
    },
    {
      key: "avg_daily_calls",
      header: "Avg Daily Calls",
      cell: (r: any) => <span className="font-mono text-xs text-muted-foreground">{r.avg_daily_calls.toLocaleString()}</span>,
    },
    {
      key: "revenue",
      header: "Est spend (USDT)",
      align: "right" as const,
      cell: (r: any) => (
        <span className="font-mono text-xs font-bold text-emerald-400">
          ${(r.calls_today * 0.00003).toFixed(5)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Actions Bar */}
      <div className="flex flex-wrap gap-4 items-center justify-between border-b border-border pb-4">
        <div>
          <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Financial Status</span>
          <div className="text-sm font-bold text-foreground">
            {financial.data?.status === "healthy" ? "Ledger Verified & Synchronized" : "Reconciliation Warnings Active"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTriggerEpoch}
            disabled={triggeringEpoch}
          >
            <Play className="mr-1 h-3.5 w-3.5 fill-current" /> Trigger Epoch Rollup
          </Button>
        </div>
      </div>

      {/* Warning feed (What requires attention?) */}
      {financial.data?.warnings && financial.data.warnings.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 p-4 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
            <AlertTriangle className="h-4 w-4" />
            <span>Active Financial Warnings Requiring Attention</span>
          </div>
          <div className="space-y-1">
            {financial.data.warnings.map((w, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-center justify-between">
                <span>{w.message}</span>
                <Badge className={w.severity === "critical" ? "bg-red-500/20 text-red-300 font-mono text-[10px]" : "bg-yellow-500/20 text-yellow-300 font-mono text-[10px]"}>
                  {w.severity.toUpperCase()}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Financial truth cards (What is happening now?) */}
      {/* Financial truth cards (What is happening now?) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Gross Metered Volume"
          value={financial.data ? `$${financial.data.metered_value_usdt.toFixed(4)} USDT` : "Loading..."}
          icon={DollarSign}
          caption="Aggregate metered query value"
        />
        <KPICard
          label="Allocated Revenue"
          value={econ.data ? `$${econ.data.totalRevenueUsdt.toFixed(4)} USDT` : "Loading..."}
          icon={Database}
          caption="Total finalized epoch revenue"
        />
        <KPICard
          label="Treasury Balance"
          value={financial.data ? `$${financial.data.treasury_real_usdt.toFixed(4)} USDT` : "Loading..."}
          icon={Coins}
          caption="On-chain vault USDT holdings"
        />
        <KPICard
          label="Epoch Payout Reserve"
          value={financial.data ? `$${financial.data.unpaid_value_usdt.toFixed(4)} USDT` : "Loading..."}
          icon={Cpu}
          caption="Owed but unpaid epoch rewards"
        />
      </div>

      {/* Waterfall & growth curve grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Waterfall Chart Card */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Revenue Deductions Waterfall</h3>
            <p className="text-[11px] text-muted-foreground">Step-down from Gross Allocated Revenue to Net Platform Share</p>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfallData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis unit=" $" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "transparent" }}
                  formatter={(val: any, name: any) => {
                    if (name === "base") return null;
                    return [`$${parseFloat(val).toFixed(4)}`, "USDT"];
                  }}
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                />
                {/* Floating stack base (invisible) */}
                <Bar dataKey="base" stackId="a" fill="transparent" />
                {/* Visible stack segment */}
                <Bar dataKey="val" stackId="a" radius={4}>
                  {waterfallData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Historical Epoch Splits Card */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Epoch Rewards Split History</h3>
            <p className="text-[11px] text-muted-foreground">Distribution of rewards across previous settled epochs</p>
          </div>

          <div className="h-60 w-full">
            {epochHistory.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No finalized epochs recorded yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={epochHistory} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis unit=" $" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(val: any) => [`$${parseFloat(String(val)).toFixed(4)}`, "USDT"]}
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                  />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="nodeShare" name="Node Operators" stackId="a" fill="#ef4444" />
                  <Bar dataKey="distributorShare" name="Distributor Pool" stackId="a" fill="#f59e0b" />
                  <Bar dataKey="platformShare" name="Platform Share" stackId="a" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

      </div>

      {/* Top Customer table */}
      <DashboardSection
        title="Top Revenue Attributed Customers"
        description="Rank of active developer keys by daily RPC call consumption volume"
        actions={
          <Button size="sm" variant="outline" onClick={fetchDevs} disabled={loadingDevs}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reload List
          </Button>
        }
        flush
      >
        {loadingDevs ? (
          <div className="p-8 text-center text-xs text-muted-foreground">Calculating developer weights...</div>
        ) : topDevs.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">No customer spend logs recorded.</div>
        ) : (
          <DataTable columns={devCols} rows={topDevs.slice(0, 10)} rowKey={(r) => r.ip} />
        )}
      </DashboardSection>

    </div>
  );
}

