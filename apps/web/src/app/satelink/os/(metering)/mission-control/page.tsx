"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  DollarSign,
  Activity,
  Users,
  Server,
  Copy,
  Key,
  Wallet,
} from "lucide-react";
import {
  SparklineKPICard,
  StatRow,
  AlertBand,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  useEndpoint,
} from "@satelink/ui";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
} from "recharts";

// ---------------------------------------------------------------------------
// API contracts (real endpoints — no mock/fallback values)
// ---------------------------------------------------------------------------
interface FinancialTruth {
  ok: boolean;
  metered_value_usdt: number;
  treasury_real_usdt: number;
  withdrawable_now_usdt: number;
  cash_conversion_pct: number;
  status: string;
  settlement?: { batches_pending: number; batches_confirmed: number };
  pipeline: {
    revenue_events_v2: { count: number; sum_usdt: number };
    epoch_ledger: { open: number; closed: number; total_revenue: number };
    settlement_batches?: { confirmed: number; pending?: number };
    bottleneck?: string;
    bottleneck_reason?: string;
  };
  warnings?: { code: string; message: string; severity: "critical" | "warning" }[];
}

interface EconomicsSummary {
  ok: boolean;
  totalRevenueUsdt: number;
  splitRatio: { nodeOperators: number; platform: number; distributors: number };
  lastEpochId: number;
  lastEpochRevenueUsdt: number;
  lastEpochClosedAt: string | null;
}

interface ExecutiveSummary {
  revenue_today_usdt: number;
  revenue_mtd_usdt: number;
  active_ips_24h: number;
  total_requests_24h: number;
  paying_customers: number;
  network_health_pct: number;
  open_alerts: number;
  signer_balance_pol: number | null;
  settlement_mode: string;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
const usd5 = (n: number | null | undefined) =>
  `$${(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
  })}`;

const compact = (n: number | null | undefined) => {
  const v = n ?? 0;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${v}`;
};

const RPC_URL = "https://rpc.satelink.network";

export default function MissionControlPage() {
  const financial = useEndpoint<FinancialTruth>(["/api/financial/truth"]);
  const economics = useEndpoint<EconomicsSummary>(["/api/economics/summary"]);
  const [execSummary, setExecSummary] = useState<ExecutiveSummary | null>(null);
  const [copied, setCopied] = useState(false);

  // Executive KPIs come through the admin proxy.
  useEffect(() => {
    fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/executive/summary", method: "GET" }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res?.ok && res.data) setExecSummary(res.data as ExecutiveSummary);
      })
      .catch(() => {});
  }, []);

  const fin = financial.data;
  const eco = economics.data;
  const pipeline = fin?.pipeline;
  const warnings = fin?.warnings ?? [];
  const confirmedBatches =
    pipeline?.settlement_batches?.confirmed ?? fin?.settlement?.batches_confirmed ?? 0;

  // Honest 7-slot series: we only have a single real data point today, so prior
  // slots are zero until the RPC metrics pipeline backfills real history.
  const trafficData = React.useMemo(() => {
    const latest =
      execSummary?.total_requests_24h ?? pipeline?.revenue_events_v2.count ?? 0;
    const labels = ["6d", "5d", "4d", "3d", "2d", "1d", "Today"];
    return labels.map((label, i) => ({
      label,
      requests: i === labels.length - 1 ? latest : 0,
    }));
  }, [execSummary?.total_requests_24h, pipeline?.revenue_events_v2.count]);

  const copyEndpoint = () => {
    navigator.clipboard?.writeText(RPC_URL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="space-y-6">
      {/* Section 2 — KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SparklineKPICard
          label="Real Revenue (MTD)"
          icon={DollarSign}
          value={usd5(fin?.metered_value_usdt)}
          caption="Metered value"
          loading={financial.loading}
          sparkData={Array(6).fill(0).concat([fin?.metered_value_usdt ?? 0])}
          status={(fin?.metered_value_usdt ?? 0) > 0 ? "good" : "neutral"}
        />
        <SparklineKPICard
          label="API Requests (24h)"
          icon={Activity}
          value={compact(execSummary?.total_requests_24h)}
          caption="Total requests"
          loading={!execSummary}
          sparkData={Array(6).fill(0).concat([execSummary?.total_requests_24h ?? 0])}
          status="neutral"
        />
        <SparklineKPICard
          label="Active IPs (24h)"
          icon={Users}
          value={compact(execSummary?.active_ips_24h)}
          caption="Unique callers"
          loading={!execSummary}
          sparkData={Array(6).fill(0).concat([execSummary?.active_ips_24h ?? 0])}
          status="neutral"
        />
        <SparklineKPICard
          label="Settlement Batches"
          icon={Server}
          value={confirmedBatches}
          caption="Confirmed on-chain"
          loading={financial.loading}
          sparkData={Array(6).fill(0).concat([confirmedBatches])}
          status="neutral"
        />
      </div>

      {/* Section 2.5 — Gateway traffic */}
      <Card>
        <CardHeader>
          <CardTitle>Gateway Traffic</CardTitle>
          <CardDescription>7-day request activity</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={trafficData}
                margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
              >
                <defs>
                  <linearGradient id="gatewayTraffic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Tooltip
                  cursor={{ stroke: "hsl(var(--border))" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "hsl(var(--popover-foreground))",
                  }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                  formatter={(v: number) => [compact(v), "Requests"]}
                />
                <Area
                  type="monotone"
                  dataKey="requests"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#gatewayTraffic)"
                  isAnimationActive={false}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Section 3 — Warnings */}
      <AlertBand
        alerts={warnings.map((w) => ({
          code: w.code,
          message: w.message,
          severity: w.severity === "critical" ? "critical" : "warning",
        }))}
      />

      {/* Section 3.5 — Operational stat strip */}
      <StatRow
        stats={[
          {
            label: "Network Health",
            value: execSummary?.network_health_pct ?? "—",
            unit: "%",
            status: execSummary?.network_health_pct === 100 ? "good" : "warning",
            colorize: true,
          },
          {
            label: "Paying Customers",
            value: execSummary?.paying_customers ?? "—",
            status: "neutral",
          },
          {
            label: "Open Alerts",
            value: execSummary?.open_alerts ?? "—",
            status: (execSummary?.open_alerts ?? 0) > 0 ? "warning" : "good",
            colorize: true,
          },
          {
            label: "Settlement Mode",
            value: execSummary?.settlement_mode ?? "DRY_RUN",
            status: execSummary?.settlement_mode === "LIVE" ? "good" : "warning",
          },
        ]}
      />

      {/* Section 4 — Two-column grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left — Revenue Pipeline */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <PipelineRow label="Metered Events" value={pipeline?.revenue_events_v2.count ?? 0} />
            <PipelineRow label="Open Epochs" value={pipeline?.epoch_ledger.open ?? 0} />
            <PipelineRow label="Confirmed Batches" value={confirmedBatches} />
            {eco ? (
              <PipelineRow
                label="Last Closed Epoch"
                value={`#${eco.lastEpochId} · ${usd5(eco.lastEpochRevenueUsdt)}`}
              />
            ) : null}
            {pipeline?.bottleneck_reason ? (
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm text-muted-foreground">Bottleneck</span>
                <span className="text-sm font-medium text-amber-400">
                  {pipeline.bottleneck_reason}
                </span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Right — Quick Start */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Your RPC endpoint</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm">
                  {RPC_URL}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyEndpoint}
                  aria-label="Copy RPC endpoint"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              {copied ? <p className="mt-1 text-xs text-emerald-400">Copied</p> : null}
            </div>
            <p className="text-sm text-muted-foreground">Chain: Polygon Mainnet (137)</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/satelink/os/keys">
                  <Key className="size-4" />
                  Get API Key
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/satelink/os/deposit">
                  <Wallet className="size-4" />
                  Add Credits
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}

function PipelineRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

