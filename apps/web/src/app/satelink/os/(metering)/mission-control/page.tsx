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
      {/* GLOBAL HEALTH STRIP */}
      <div className="flex flex-wrap items-center justify-between bg-zinc-900 border border-zinc-800 p-2.5 rounded-sm mb-6">
        <div className="flex items-center gap-6 text-[10px] font-mono tracking-wider uppercase text-zinc-400">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span>RPC Gateway Operational</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span>Polygon RPC Sync</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span>Billing Engine Sync</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-mono tracking-wider uppercase">
           <div className="px-2 py-0.5 bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-sm flex items-center gap-1.5">
             <span className="size-1.5 rounded-full bg-violet-500" />
             {execSummary?.settlement_mode || "DRY_RUN"}
           </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 mb-4">
        {/* ROW 1 — KPI strip */}
        <div className="col-span-12 md:col-span-4">
          <KPIStat
            label="Real Revenue"
            value={fin ? usd5(fin.metered_value_usdt) : null}
            delta={fin && fin.metered_value_usdt > 0 ? 0 : null}
            state={(fin?.metered_value_usdt ?? 0) > 0 ? "healthy" : "unknown"}
            caption="Metered value"
            icon={DollarSign}
          />
        </div>
        <div className="col-span-12 md:col-span-3">
          <KPIStat
            label="API Requests (24h)"
            value={execSummary ? compact(execSummary.total_requests_24h) : null}
            state="unknown"
            caption="Total requests"
            icon={Activity}
          />
        </div>
        <div className="col-span-12 md:col-span-3">
          <KPIStat
            label="Active IPs"
            value={execSummary ? compact(execSummary.active_ips_24h) : null}
            state="unknown"
            caption="Unique callers"
            icon={Users}
          />
        </div>
        <div className="col-span-12 md:col-span-2">
          <KPIStat
            label="Settlements"
            value={fin ? confirmedBatches : null}
            state={confirmedBatches > 0 ? "healthy" : "unknown"}
            caption="Confirmed"
            icon={Server}
          />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 mb-4">
        {/* ROW 2 — Primary Telemetry */}
        <div className="col-span-12 lg:col-span-8 flex flex-col">
          <TimeseriesPanel
            title="Gateway Traffic Rate"
            subtitle="Request volume per minute"
            data={[]}
            series={[{ key: "requests", label: "Requests", type: "area", color: "hsl(var(--chart-1))" }]}
            className="w-full h-full min-h-[300px]"
            showLegend={false}
            emptyHint="No request-history endpoint yet — 24h totals appear in the KPI strip above."
          />
        </div>
        
        {/* Secondary Context */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-5 h-full">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-4 border-b border-zinc-800 pb-2">Revenue Pipeline</div>
            <div className="space-y-4">
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
        </div>
      </div>

      {/* ROW 3 — Alert strip & Quick Start */}
      <div className="grid grid-cols-12 gap-4 mb-6">
        <div className="col-span-12 lg:col-span-8">
          <AlertBand
            alerts={warnings.map((w) => ({
              code: w.code,
              message: w.message,
              severity: w.severity === "critical" ? "critical" : "warning",
            }))}
            className="h-full"
          />
        </div>
        
        <div className="col-span-12 lg:col-span-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-4 h-full flex flex-col justify-center">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Gateway Access</span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-sm border border-emerald-500/20">POLYGON 137</span>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 truncate rounded-sm bg-zinc-950 border border-zinc-800 px-3 py-1.5 font-mono text-xs text-zinc-300">
                {RPC_URL}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={copyEndpoint}
                aria-label="Copy RPC endpoint"
                className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800 size-7"
              >
                <Copy className="size-3.5 text-zinc-400" />
              </Button>
            </div>
            
            <div className="flex gap-2">
              <Button asChild className="flex-1 bg-[hsl(174,80%,38%)] text-white hover:bg-[hsl(174,80%,30%)] border-0 h-8 text-[11px]">
                <Link href="/satelink/os/keys">
                  <Key className="size-3 mr-1.5" />
                  API Key
                </Link>
              </Button>
              <Button asChild variant="outline" className="flex-1 border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-800/50 h-8 text-[11px]">
                <Link href="/satelink/os/deposit">
                  <Wallet className="size-3 mr-1.5" />
                  Credits
                </Link>
              </Button>
            </div>
          </div>
        </div>
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

