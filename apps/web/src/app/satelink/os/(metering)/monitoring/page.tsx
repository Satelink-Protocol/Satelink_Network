"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import {
  Activity,
  Server,
  DollarSign,
  Landmark,
  Gauge,
  Wifi,
  Search,
  Pause,
  Play,
  Download,
  Clock,
  Layers,
  Terminal,
  Grid
} from "lucide-react";
import {
  GrafanaPanel,
  Badge,
  StatusBadge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  KPICard,
  DashboardSection,
} from "@satelink/ui";
import { FilterPanel } from "@/components/satelink-os/filters/FilterPanel";
import { TimeRangeSelector, type TimeRangeValue } from "@/components/satelink-os/toolbars/TimeRangeSelector";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line
} from "recharts";

// Grafana configuration
const UID = {
  overview: process.env.NEXT_PUBLIC_GRAFANA_UID_OVERVIEW || "satelink-exec-overview",
  rpc: process.env.NEXT_PUBLIC_GRAFANA_UID_RPC || "satelink-rpc-throughput",
  provider: process.env.NEXT_PUBLIC_GRAFANA_UID_PROVIDER || "satelink-network-health",
  revenue: process.env.NEXT_PUBLIC_GRAFANA_UID_REVENUE || "satelink-tenant-usage",
  settlement: process.env.NEXT_PUBLIC_GRAFANA_UID_SETTLEMENT || "satelink-settlement-epochs",
  alerts: process.env.NEXT_PUBLIC_GRAFANA_UID_ALERTS || "satelink-alerts",
};

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
  const [rpc, setRpc] = useState<RpcHealth | null>(null);
  const [err, setErr] = useState(false);
  // Grafana is behind /api/grafana (needs GRAFANA_URL/GRAFANA_TOKEN server-side).
  // Until it's deployed the panels would render as dead iframes (audit #27), so
  // probe once and show one honest empty state instead.
  const [grafanaReady, setGrafanaReady] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/grafana/api/health", { cache: "no-store" })
      .then((r) => setGrafanaReady(r.ok))
      .catch(() => setGrafanaReady(false));
  }, []);



  const load = useCallback(async () => {
    setErr(false);
    try {
      const [s, t, f, r] = await Promise.all([
        fetch("/api/status").then((r) => r.json()).catch(() => null),
        fetch("/api/treasury/status").then((r) => r.json()).catch(() => null),
        fetch("/stats/free-tier").then((r) => r.json()).catch(() => null),
        fetch("/rpc/health").then((r) => r.json()).catch(() => null),
      ]);
      setStatus(s);
      setTreasury(t);
      setFreeTier(f);
      setRpc(r);
      if (!s && !t && !f && !r) setErr(true);
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);



  return (
    <div className="space-y-6">
      {/* Overview — real KPIs from the live API */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">Live platform health — sourced directly from the gateway API</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* uptime_pct / avg_latency_ms are measured (node_health_logs 24h) and
              may be null when there is no sample — show "—", never a stand-in. */}
          <KPICard label="Requests (today, UTC)" icon={Activity} value={num(status?.total_requests_24h)} caption={status?.uptime_pct != null ? `${status.uptime_pct}% measured uptime` : "uptime sample unavailable"} />
          <KPICard label="Latency (p50, 24h)" icon={Gauge} value={status?.avg_latency_ms != null ? `${status.avg_latency_ms} ms` : "—"} caption={status ? `${status.chains_supported?.length ?? 0} chains` : ""} />
          <KPICard label="Nodes Online" icon={Server} value={num(status?.nodes_online)} caption={`epoch ${status?.current_epoch ?? "—"}`} />
          <KPICard label="Vault Balance" icon={Landmark} value={treasury ? `$${treasury.vault_balance_usdt} USDT` : "—"} caption={treasury ? `${treasury.active_wallets} active wallet(s)` : ""} />
        </div>
      </div>

      {/* Free-tier + treasury KPIs — real API values, independent of Grafana */}
      {freeTier ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard label="Active IPs" icon={Wifi} value={num(freeTier.activeIPs)} caption="today (UTC)" />
          <KPICard label="Near Limit" value={num(freeTier.nearLimitIPs)} caption={`limit ${freeTier.limit}/day`} />
          <KPICard label="Total Calls" icon={Activity} value={num(freeTier.totalCalls)} caption="free tier, today (UTC)" />
          <KPICard label="Deposited" icon={DollarSign} value={treasury ? `$${treasury.total_deposited_usdt}` : "—"} caption="USDT lifetime" />
        </div>
      ) : null}

      {/* EMBEDDED GRAFANA PANELS — rendered only when the /api/grafana proxy is
          actually configured; otherwise one honest empty state (audit #27). */}
      {grafanaReady === false && (
        <div className="mt-8 border-t border-border pt-8">
          <div className="rounded-md border border-border bg-card p-8 text-center">
            <p className="text-sm font-medium text-foreground">Grafana dashboards not connected yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Time-series panels appear here once the monitoring stack is deployed
              (GRAFANA_URL + GRAFANA_TOKEN). The KPIs above are live from the gateway API.
            </p>
          </div>
        </div>
      )}
      {grafanaReady && (
      <div className="space-y-6 mt-8 border-t border-border pt-8">
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
          </DashboardSection>
        </div>
      )}
      </div>
  );
}
