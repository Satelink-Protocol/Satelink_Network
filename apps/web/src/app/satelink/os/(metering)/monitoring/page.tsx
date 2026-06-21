"use client";

/*
 * Satelink OS — Monitoring.
 * A real-data KPI strip (from the live API) over embedded Grafana panels.
 * Every panel renders through the server-side Grafana embed BFF
 * (/api/grafana/...); no panel talks to Grafana directly, and no data here is
 * mocked — when the monitoring backend is offline the panels show an honest
 * "unavailable" state via <GrafanaPanel>.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Server,
  DollarSign,
  Landmark,
  Gauge,
  Wifi,
} from "lucide-react";
import {
  DashboardSection,
  KPIGrid,
  StatCard,
  GrafanaPanel,
} from "@satelink/ui";

// Dashboard UIDs are overridable per-environment; defaults match the embed
// blueprint (docs/ui-recovery/GRAFANA_INTEGRATION_PLAN.md). The values are
// embedded at build time via NEXT_PUBLIC_* so the client can build embed URLs.
const UID = {
  overview: process.env.NEXT_PUBLIC_GRAFANA_UID_OVERVIEW || "satelink-exec-overview",
  rpc: process.env.NEXT_PUBLIC_GRAFANA_UID_RPC || "satelink-rpc-throughput",
  provider: process.env.NEXT_PUBLIC_GRAFANA_UID_PROVIDER || "satelink-network-health",
  revenue: process.env.NEXT_PUBLIC_GRAFANA_UID_REVENUE || "satelink-tenant-usage",
  settlement: process.env.NEXT_PUBLIC_GRAFANA_UID_SETTLEMENT || "satelink-settlement-epochs",
  alerts: process.env.NEXT_PUBLIC_GRAFANA_UID_ALERTS || "satelink-alerts",
};

/** Build a single-panel ("d-solo") embed URL routed through the BFF. */
function panel(uid: string, panelId: number, slug = "satelink"): string {
  return `/api/grafana/d-solo/${uid}/${slug}?panelId=${panelId}&kiosk&refresh=30s`;
}

interface StatusData {
  status: string;
  uptime_pct: number;
  nodes_online: number;
  current_epoch: number;
  total_requests_24h: number;
  avg_latency_ms: number;
  chains_supported: string[];
}
interface TreasuryData {
  vault_balance_usdt: number;
  total_deposited_usdt: number;
  active_wallets: number;
}
interface FreeTierData {
  activeIPs: number;
  totalCalls: number;
  nearLimitIPs: number;
  limit: number;
}

function num(n: number | undefined | null): string {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export default function MonitoringPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [treasury, setTreasury] = useState<TreasuryData | null>(null);
  const [freeTier, setFreeTier] = useState<FreeTierData | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    setErr(false);
    try {
      const [s, t, f] = await Promise.all([
        fetch("/api/status").then((r) => r.json()).catch(() => null),
        fetch("/api/treasury/status").then((r) => r.json()).catch(() => null),
        fetch("/stats/free-tier").then((r) => r.json()).catch(() => null),
      ]);
      setStatus(s);
      setTreasury(t);
      setFreeTier(f);
      if (!s && !t && !f) setErr(true);
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const loading = !status && !treasury && !freeTier && !err;

  return (
    <div className="space-y-6">
      {/* Overview — real KPIs from the live API */}
      <DashboardSection
        title="Overview"
        description="Live platform health — sourced directly from the gateway API"
        card={false}
      >
        <KPIGrid columns={4}>
          <StatCard
            label="Requests (24h)"
            icon={Activity}
            loading={loading}
            accent
            value={num(status?.total_requests_24h)}
            caption={status ? `${status.uptime_pct}% uptime` : "gateway metering"}
          />
          <StatCard
            label="Avg Latency"
            icon={Gauge}
            loading={loading}
            value={status ? `${status.avg_latency_ms} ms` : "—"}
            caption={status ? `${status.chains_supported?.length ?? 0} chains` : ""}
          />
          <StatCard
            label="Nodes Online"
            icon={Server}
            loading={loading}
            value={num(status?.nodes_online)}
            caption={`epoch ${status?.current_epoch ?? "—"}`}
          />
          <StatCard
            label="Vault Balance"
            icon={Landmark}
            loading={loading}
            value={treasury ? `$${treasury.vault_balance_usdt} USDT` : "—"}
            caption={treasury ? `${treasury.active_wallets} active wallet(s)` : ""}
          />
        </KPIGrid>
      </DashboardSection>

      <GrafanaPanel
        title="Platform Overview"
        description="Composite executive dashboard"
        src={panel(UID.overview, 1)}
        height={280}
      />

      {/* RPC Health */}
      <DashboardSection
        title="RPC Health"
        description="Throughput, latency and error rate across the gateway"
        card={false}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GrafanaPanel title="RPC Throughput" src={panel(UID.rpc, 1)} />
          <GrafanaPanel title="RPC Latency (p50/p95/p99)" src={panel(UID.rpc, 2)} />
          <GrafanaPanel title="Error Rate" src={panel(UID.rpc, 3)} />
          <GrafanaPanel title="Free-tier Pressure" src={panel(UID.rpc, 4)} />
        </div>
      </DashboardSection>

      {/* Provider Health */}
      <DashboardSection
        title="Provider Health"
        description="Upstream node/provider availability and failovers"
        card={false}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GrafanaPanel title="Provider Availability" src={panel(UID.provider, 1)} />
          <GrafanaPanel title="Failovers & Circuit Breakers" src={panel(UID.provider, 2)} />
        </div>
      </DashboardSection>

      {/* Revenue Metrics */}
      <DashboardSection
        title="Revenue Metrics"
        description="Metered revenue and per-tenant consumption"
        card={false}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GrafanaPanel title="Metered Revenue" src={panel(UID.revenue, 1)} />
          <GrafanaPanel title="Usage by Tenant" src={panel(UID.revenue, 2)} />
        </div>
      </DashboardSection>

      {/* Settlement Metrics */}
      <DashboardSection
        title="Settlement Metrics"
        description="Epoch settlement, anchoring and treasury flow"
        card={false}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GrafanaPanel title="Epoch Settlements" src={panel(UID.settlement, 1)} />
          <GrafanaPanel title="Treasury Inflow" src={panel(UID.settlement, 2)} />
        </div>
      </DashboardSection>

      {/* Alerts */}
      <DashboardSection
        title="Alerts"
        description="Firing alerts from Grafana Unified Alerting"
        card={false}
      >
        <GrafanaPanel
          title="Alert State Timeline"
          description="near-limit IPs and provider faults"
          src={panel(UID.alerts, 1)}
          height={260}
        />
        {freeTier ? (
          <KPIGrid columns={4} className="mt-4">
            <StatCard label="Active IPs" icon={Wifi} value={num(freeTier.activeIPs)} caption="last 24h" />
            <StatCard label="Near Limit" value={num(freeTier.nearLimitIPs)} caption={`limit ${freeTier.limit}/day`} />
            <StatCard label="Total Calls" icon={Activity} value={num(freeTier.totalCalls)} caption="free tier" />
            <StatCard label="Deposited" icon={DollarSign} value={treasury ? `$${treasury.total_deposited_usdt}` : "—"} caption="USDT lifetime" />
          </KPIGrid>
        ) : null}
      </DashboardSection>
    </div>
  );
}
