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
  KPIStat,
  StatRow,
  AlertBand,
  TimeseriesPanel,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  useEndpoint,
} from "@satelink/ui";

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

  const copyEndpoint = () => {
    navigator.clipboard?.writeText(RPC_URL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="px-6 py-6">
      {/* ROW 1 — KPI strip */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        {/* Card 1: REAL REVENUE */}
        <div className="relative bg-zinc-900 border border-zinc-800 rounded-sm p-5 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-[hsl(174,80%,38%)]" />
          <div className="flex items-start justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Real Revenue</span>
            <DollarSign className="h-4 w-4 text-zinc-600" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tabular-nums mb-1">{fin ? usd5(fin.metered_value_usdt) : "—"}</div>
          <div className="flex items-center gap-1.5">
            {(fin?.metered_value_usdt ?? 0) > 0 ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-500/15 text-green-400">▲ +0%</span>
            ) : (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-500/15 text-zinc-400">—</span>
            )}
            <span className="text-xs text-zinc-500">Metered value</span>
          </div>
        </div>

        {/* Card 2: API REQUESTS (24H) */}
        <div className="relative bg-zinc-900 border border-zinc-800 rounded-sm p-5 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-[hsl(174,80%,38%)]" />
          <div className="flex items-start justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">API Requests (24h)</span>
            <Activity className="h-4 w-4 text-zinc-600" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tabular-nums mb-1">{execSummary ? compact(execSummary.total_requests_24h) : "—"}</div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-500/15 text-zinc-400">—</span>
            <span className="text-xs text-zinc-500">Total requests</span>
          </div>
        </div>

        {/* Card 3: ACTIVE IPs */}
        <div className="relative bg-zinc-900 border border-zinc-800 rounded-sm p-5 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-[hsl(174,80%,38%)]" />
          <div className="flex items-start justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Active IPs</span>
            <Users className="h-4 w-4 text-zinc-600" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tabular-nums mb-1">{execSummary ? compact(execSummary.active_ips_24h) : "—"}</div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-500/15 text-zinc-400">—</span>
            <span className="text-xs text-zinc-500">Unique callers</span>
          </div>
        </div>

        {/* Card 4: SETTLEMENT BATCHES */}
        <div className="relative bg-zinc-900 border border-zinc-800 rounded-sm p-5 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-[hsl(174,80%,38%)]" />
          <div className="flex items-start justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Settlement Batches</span>
            <Server className="h-4 w-4 text-zinc-600" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tabular-nums mb-1">{fin ? confirmedBatches : "—"}</div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-500/15 text-zinc-400">—</span>
            <span className="text-xs text-zinc-500">Confirmed on-chain</span>
          </div>
        </div>
      </div>

      {/* ROW 2 — Full width chart */}
      <div className="mb-6">
        <TimeseriesPanel
          title="Gateway Traffic"
          subtitle="Request rate over time"
          data={[]}
          series={[{ key: "requests", label: "Requests", type: "area", color: "hsl(var(--chart-1))" }]}
          className="w-full min-h-[300px]"
          showLegend={false}
          emptyHint="No request-history endpoint yet — 24h totals appear in the KPI strip above."
        />
      </div>

      {/* ROW 3 — Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Left — Revenue Pipeline */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-5">
          <div className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-3">Revenue Pipeline</div>
          <div className="space-y-3">
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
                <span className="text-xs text-zinc-500">Bottleneck</span>
                <span className="text-xs font-medium text-amber-400">
                  {pipeline.bottleneck_reason}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right — Quick Start */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-5">
          <div className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-3">Quick Start</div>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-zinc-500">Your RPC endpoint</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-zinc-950 border border-zinc-800/50 px-3 py-2 font-mono text-sm text-zinc-300">
                  {RPC_URL}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyEndpoint}
                  aria-label="Copy RPC endpoint"
                  className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
                >
                  <Copy className="size-4 text-zinc-400" />
                </Button>
              </div>
              {copied ? <p className="mt-1 text-xs text-emerald-400">Copied</p> : null}
            </div>
            <p className="text-xs text-zinc-500">Chain: Polygon Mainnet (137)</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="bg-[hsl(174,80%,38%)] text-white hover:bg-[hsl(174,80%,30%)] border-0">
                <Link href="/satelink/os/keys">
                  <Key className="size-4 mr-2" />
                  Get API Key
                </Link>
              </Button>
              <Button asChild variant="outline" className="border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-800/50">
                <Link href="/satelink/os/deposit">
                  <Wallet className="size-4 mr-2" />
                  Add Credits
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ROW 4 — Alert strip */}
      <div className="mb-6">
        <AlertBand
          alerts={warnings.map((w) => ({
            code: w.code,
            message: w.message,
            severity: w.severity === "critical" ? "critical" : "warning",
          }))}
          className="[&>div]:h-9 [&>div]:py-0 [&>div]:min-h-9"
        />
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

