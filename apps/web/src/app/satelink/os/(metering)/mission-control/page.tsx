"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  DollarSign,
  Activity,
  Users,
  Server,
  AlertTriangle,
  Copy,
  Key,
  Wallet,
} from "lucide-react";
import {
  KPICard,
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
    <div className="space-y-6">
      {/* Section 1 — Page header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Mission Control</h2>
        <p className="text-sm text-muted-foreground">
          Real-time revenue, settlement, and network health for the Satelink RPC gateway.
        </p>
      </div>

      {/* Section 2 — KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Real Revenue (MTD)"
          icon={DollarSign}
          value={usd5(fin?.metered_value_usdt)}
          caption="Metered value"
          loading={financial.loading}
        />
        <KPICard
          label="API Requests (24h)"
          icon={Activity}
          value={compact(execSummary?.total_requests_24h)}
          caption="Total requests"
          loading={!execSummary}
        />
        <KPICard
          label="Active IPs (24h)"
          icon={Users}
          value={compact(execSummary?.active_ips_24h)}
          caption="Unique callers"
          loading={!execSummary}
        />
        <KPICard
          label="Settlement Batches"
          icon={Server}
          value={confirmedBatches}
          caption="Confirmed on-chain"
          loading={financial.loading}
        />
      </div>

      {/* Section 3 — Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w) => (
            <div
              key={w.code}
              className={
                "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm " +
                (w.severity === "critical"
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-300")
              }
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <span className="font-semibold">{w.code}</span>
                <span className="ml-2">{w.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

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

      {/* Section 5 — Network Health bar */}
      <Card>
        <CardContent className="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <HealthStat
            label="Network Health"
            value={execSummary ? `${execSummary.network_health_pct}%` : "—"}
          />
          <HealthStat
            label="Paying Customers"
            value={execSummary ? `${execSummary.paying_customers}` : "—"}
          />
          <HealthStat
            label="Open Alerts"
            value={execSummary ? `${execSummary.open_alerts}` : "—"}
          />
          <HealthStat label="Settlement Mode" value={execSummary?.settlement_mode ?? "—"} />
        </CardContent>
      </Card>
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

function HealthStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-lg font-semibold text-foreground">{value}</span>
    </div>
  );
}
