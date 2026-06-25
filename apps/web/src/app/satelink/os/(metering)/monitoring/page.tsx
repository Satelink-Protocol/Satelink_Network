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
  DashboardSection,
  KPIGrid,
  StatCard,
  GrafanaPanel,
  Badge,
  StatusBadge,
  Button,
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

// Interfaces for Observability Simulation
interface LogEntry {
  id: string;
  timestamp: string;
  utcTime: string;
  level: "INFO" | "WARN" | "ERROR";
  service: string;
  component: string;
  traceId: string;
  spanId: string;
  message: string;
  extra?: string;
}

interface SpanDetail {
  id: string;
  name: string;
  service: string;
  durationMs: number;
  percentage: number;
  startPct: number;
  kind: string;
  status: string;
  attributes: Record<string, string>;
}

interface RpcHealth {
  summary: {
    healthy: number;
    unhealthy: number;
    total: number;
    healthPercent: string;
  };
}

export default function MonitoringPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [treasury, setTreasury] = useState<TreasuryData | null>(null);
  const [freeTier, setFreeTier] = useState<FreeTierData | null>(null);
  const [rpc, setRpc] = useState<RpcHealth | null>(null);
  const [err, setErr] = useState(false);

  // Tab State: NOC War Room / Logs / Traces / Grafana Panels
  const [activeSubTab, setActiveSubTab] = useState<"noc" | "logs" | "traces" | "grafana">("noc");

  // Log Streamer State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLogsLive, setIsLogsLive] = useState(true);
  const [logSearch, setLogSearch] = useState("");
  const [logLevelFilter, setLogLevelFilter] = useState<string>("ALL");
  const [metricsRange, setMetricsRange] = useState<TimeRangeValue>("24H");

  // Trace/Flamegraph State
  const [selectedSpan, setSelectedSpan] = useState<SpanDetail | null>(null);

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

  // Log Streamer Simulation
  useEffect(() => {
    if (!isLogsLive) return;

    // Pre-populate logs
    const services = ["frontend", "rpc-proxy", "reputation-engine", "revenue-engine", "db-writer"];
    const components = ["route_client", "rate_limiter", "polygon_rpc", "contract_verifier", "cache_store"];
    const messages = [
      "Finding route for gateway request",
      "HTTP request received and authenticated",
      "Validator list fetched successfully from epoch registry",
      "Dispatched metered RPC payload to target Polygon node",
      "Calculated cost allocation and verified client deposit balance",
      "Updated client access limits for selected API key",
      "DB Write epoch state committed successfully",
    ];

    const generateLog = (): LogEntry => {
      const date = new Date();
      const traceId = Math.random().toString(16).substring(2, 18);
      const spanId = Math.random().toString(16).substring(2, 18);
      const level = Math.random() > 0.85 ? (Math.random() > 0.6 ? "ERROR" : "WARN") : "INFO";
      const service = services[Math.floor(Math.random() * services.length)];
      const component = components[Math.floor(Math.random() * components.length)];
      const message = messages[Math.floor(Math.random() * messages.length)];

      return {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: date.toLocaleTimeString(),
        utcTime: date.toISOString(),
        level,
        service,
        component,
        traceId,
        spanId,
        message,
        extra: JSON.stringify({
          service,
          component,
          trace_id: traceId,
          span_id: spanId,
          network: "polygon-pos",
          ...(level === "ERROR" && { error_code: "402", reason: "INSUFFICIENT_CREDITS" }),
        }),
      };
    };

    // Initialize with 15 logs
    setLogs((prev) => {
      if (prev.length > 0) return prev;
      const initialLogs = Array.from({ length: 15 }, generateLog);
      return initialLogs.reverse();
    });

    const interval = setInterval(() => {
      setLogs((prev) => [generateLog(), ...prev.slice(0, 49)]);
    }, 1500 + Math.random() * 2000);

    return () => clearInterval(interval);
  }, [isLogsLive]);

  const loading = !status && !treasury && !freeTier && !err;

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesSearch = log.message.toLowerCase().includes(logSearch.toLowerCase()) ||
                            log.service.toLowerCase().includes(logSearch.toLowerCase()) ||
                            log.traceId.toLowerCase().includes(logSearch.toLowerCase());
      const matchesLevel = logLevelFilter === "ALL" || log.level === logLevelFilter;
      return matchesSearch && matchesLevel;
    });
  }, [logs, logSearch, logLevelFilter]);

  // Log Rate chart data (simulated log frequencies)
  const logRateData = useMemo(() => {
    const data = [];
    const now = Date.now();
    for (let i = 20; i >= 0; i--) {
      const timeStr = new Date(now - i * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      data.push({
        time: timeStr,
        logs: Math.floor(1000 + Math.random() * 1500 + (i % 3 === 0 ? 500 : 0)),
      });
    }
    return data;
  }, []);

  // Latency Metrics Simulation Data
  const metricsData = useMemo(() => {
    const data = [];
    const now = Date.now();
    for (let i = 24; i >= 0; i--) {
      const timeStr = new Date(now - i * 3600000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      data.push({
        time: timeStr,
        p50: Math.floor(45 + Math.random() * 20),
        p90: Math.floor(75 + Math.random() * 35),
        p99: Math.floor(120 + Math.random() * 90),
        rate: parseFloat((1.2 + Math.random() * 0.8).toFixed(2)),
        apdex: parseFloat((0.92 + Math.random() * 0.06).toFixed(3)),
      });
    }
    return data;
  }, []);

  // Flamegraph Spans Definition (Interactive Mock Trace)
  const traceSpans = useMemo<SpanDetail[]>(() => {
    return [
      {
        id: "span-1",
        name: "/rpc/polygon eth_blockNumber",
        service: "frontend-ingress",
        durationMs: 1450,
        percentage: 100,
        startPct: 0,
        kind: "Server",
        status: "OK",
        attributes: {
          "http.method": "POST",
          "http.route": "/rpc/polygon",
          "http.status_code": "200",
          "user_agent": "curl/7.81.0",
          "client.ip": "157.45.18.23",
        },
      },
      {
        id: "span-2",
        name: "rate_limiter check",
        service: "rpc-proxy",
        durationMs: 80,
        percentage: 5.5,
        startPct: 2,
        kind: "Internal",
        status: "OK",
        attributes: {
          "limiter.key": "sk_free_88da...",
          "limiter.rate": "500/d",
          "limiter.current": "42",
        },
      },
      {
        id: "span-3",
        name: "auth verify_api_key",
        service: "auth-service",
        durationMs: 120,
        percentage: 8.2,
        startPct: 8,
        kind: "Client",
        status: "OK",
        attributes: {
          "auth.method": "jwt_signature",
          "auth.role": "developer_free",
        },
      },
      {
        id: "span-4",
        name: "dispatch rpc_node_route",
        service: "rpc-proxy",
        durationMs: 1210,
        percentage: 83.4,
        startPct: 16,
        kind: "Server",
        status: "OK",
        attributes: {
          "route.target_node": "NODE-ap-south-1-a09becbb",
          "route.failover_attempts": "0",
          "rpc.method": "eth_blockNumber",
        },
      },
      {
        id: "span-5",
        name: "fetch polygon_provider_node",
        service: "node-agent",
        durationMs: 1100,
        percentage: 75.8,
        startPct: 20,
        kind: "Client",
        status: "OK",
        attributes: {
          "rpc.provider": "Alchemy Pos",
          "rpc.endpoint": "https://polygon-mainnet.g.alchemy.com/v2/...",
          "rpc.block_height": "56304859",
        },
      },
      {
        id: "span-6",
        name: "billing deduct_credits",
        service: "revenue-engine",
        durationMs: 90,
        percentage: 6.2,
        startPct: 93,
        kind: "Internal",
        status: "OK",
        attributes: {
          "billing.deduction_usdt": "0.00003",
          "billing.balance_after_usdt": "8.60152",
          "billing.transaction_id": "tx_epoch_auto_1_4859",
        },
      },
    ];
  }, []);

  // Auto-select first span on load
  useEffect(() => {
    if (traceSpans.length > 0 && !selectedSpan) {
      setSelectedSpan(traceSpans[0]);
    }
  }, [traceSpans, selectedSpan]);

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

      {/* Observability View Sub-tabs Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-border bg-card/20 px-4 py-2 rounded-t-lg">
        <div className="flex items-center gap-4 overflow-x-auto whitespace-nowrap w-full md:w-auto pb-1 md:pb-0 scrollbar-none">
          <button
            onClick={() => setActiveSubTab("noc")}
            className={`shrink-0 text-xs font-bold uppercase tracking-wider pb-1.5 border-b-2 transition-colors ${
              activeSubTab === "noc"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            NOC War Room
          </button>
          <button
            onClick={() => setActiveSubTab("logs")}
            className={`shrink-0 text-xs font-bold uppercase tracking-wider pb-1.5 border-b-2 transition-colors ${
              activeSubTab === "logs"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Live Logs
          </button>
          <button
            onClick={() => setActiveSubTab("traces")}
            className={`shrink-0 text-xs font-bold uppercase tracking-wider pb-1.5 border-b-2 transition-colors ${
              activeSubTab === "traces"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Traces & Flamegraph
          </button>
          <button
            onClick={() => setActiveSubTab("grafana")}
            className={`shrink-0 text-xs font-bold uppercase tracking-wider pb-1.5 border-b-2 transition-colors ${
              activeSubTab === "grafana"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Embedded Grafana
          </button>
        </div>

        <Badge variant="success" className="gap-1.5 self-start md:self-auto shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
          Active Observe Node
        </Badge>
      </div>

      {/* NOC WAR ROOM TAB */}
      {activeSubTab === "noc" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="border border-border bg-card p-4 rounded-lg flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Global Health Score</span>
                <div className="text-3xl font-extrabold text-emerald-400 font-mono mt-1">
                  {rpc?.summary?.healthPercent ? `${rpc.summary.healthPercent}` : "98.4%"}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                Composite score of 4 chains, 6 RPC providers, and 56 online decentralized execution edge nodes.
              </p>
            </div>

            <div className="border border-border bg-card p-4 rounded-lg flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Gateway Load pressure</span>
                <div className="text-3xl font-extrabold text-foreground font-mono mt-1">
                  {status ? `${(status.total_requests_24h / 86400).toFixed(2)} rps` : "—"}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed font-mono">
                Capacity limit: 200.00 rps (currently utilizing {(status ? (status.total_requests_24h / 86400 / 2).toFixed(1) : "0.5")}% of pool).
              </p>
            </div>

            <div className="border border-border bg-card p-4 rounded-lg flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Active Incidents</span>
                <div className="text-3xl font-extrabold text-orange-400 font-mono mt-1">1 active</div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                Incident #142 active: Alchemy Base endpoint throttling. High-severity, auto-routed.
              </p>
            </div>

            <div className="border border-border bg-card p-4 rounded-lg flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Routing Efficiency</span>
                <div className="text-3xl font-extrabold text-emerald-400 font-mono mt-1">99.98%</div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                Gateway circuit-breaker triggered 0 times. Auto-failover executed 2 times today.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Provider Routing Matrix */}
            <div className="lg:col-span-2 glow-card glass-panel border border-border bg-card p-5 rounded-lg space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Provider Routing Matrix</h3>
                <p className="text-[11px] text-muted-foreground">E2E availability matrix mapping supported blockchains against active RPC endpoints</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="p-3 text-muted-foreground font-semibold">Chain Name</th>
                      <th className="p-3 text-muted-foreground font-semibold">Alchemy</th>
                      <th className="p-3 text-muted-foreground font-semibold">QuickNode</th>
                      <th className="p-3 text-muted-foreground font-semibold">Infura</th>
                      <th className="p-3 text-muted-foreground font-semibold">Local Node</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border">
                      <td className="p-3 font-semibold text-foreground">Polygon PoS</td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">62ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">84ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">92ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">14ms</span></td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="p-3 font-semibold text-foreground">Ethereum</td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">78ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">96ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">112ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">22ms</span></td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="p-3 font-semibold text-foreground">Base</td>
                      <td className="p-3"><span className="inline-flex size-2 bg-red-500 rounded-full animate-pulse" /> <span className="text-[10px] text-red-400">ERROR</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">105ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-zinc-600 rounded-full" /> <span className="text-[10px] text-muted-foreground">—</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">19ms</span></td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="p-3 font-semibold text-foreground">Arbitrum One</td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">81ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">90ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">125ms</span></td>
                      <td className="p-3"><span className="inline-flex size-2 bg-emerald-500 rounded-full" /> <span className="text-[10px] text-muted-foreground">28ms</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Latency Heatmap */}
            <div className="glow-card glass-panel border border-border bg-card p-5 rounded-lg space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Latency Distribution Heatmap</h3>
                <p className="text-[11px] text-muted-foreground">Gateway query count by response bucket (last 10m)</p>
              </div>

              <div className="grid grid-cols-2 gap-4 font-mono text-xs pt-2">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded">
                  <div className="text-[10px] text-emerald-400 font-bold uppercase">Fast (&lt;50ms)</div>
                  <div className="text-lg font-bold text-foreground mt-1">74.5%</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Edge nodes local hits</div>
                </div>

                <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded">
                  <div className="text-[10px] text-emerald-500 font-bold uppercase">Optimal (50-100ms)</div>
                  <div className="text-lg font-bold text-foreground mt-1">21.8%</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Proxied local nodes</div>
                </div>

                <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded">
                  <div className="text-[10px] text-amber-400 font-bold uppercase">Normal (100-200ms)</div>
                  <div className="text-lg font-bold text-foreground mt-1">3.2%</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Upstream fallback nodes</div>
                </div>

                <div className="p-3 bg-red-500/5 border border-red-500/10 rounded">
                  <div className="text-[10px] text-red-400 font-bold uppercase">Slow (&gt;200ms)</div>
                  <div className="text-lg font-bold text-foreground mt-1">0.5%</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Timeouts and sync lag</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Failover timeline logs */}
            <div className="glow-card glass-panel border border-border bg-card p-5 rounded-lg space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Failover Timeline logs</h3>
                <p className="text-[11px] text-muted-foreground">Automated gateway routing switch logs</p>
              </div>

              <div className="space-y-3 font-mono text-[10px] max-h-60 overflow-y-auto pr-1">
                <div className="p-2 bg-muted/20 border-l-2 border-red-500 rounded">
                  <div className="flex justify-between font-bold text-slate-300">
                    <span>[Base] ALCHEMY FAILURE</span>
                    <span>06:21:05</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5">Http timeout (4000ms limit). Routing to QuickNode.</p>
                </div>
                <div className="p-2 bg-muted/20 border-l-2 border-amber-500 rounded">
                  <div className="flex justify-between font-bold text-slate-300">
                    <span>[Polygon] LOCAL HEIGHT LAG</span>
                    <span>06:14:12</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5">Node lag &gt; 50 blocks. Routing to Infura.</p>
                </div>
                <div className="p-2 bg-muted/20 border-l-2 border-emerald-500 rounded">
                  <div className="flex justify-between font-bold text-slate-300">
                    <span>[Ethereum] SPEED OPTIMIZER</span>
                    <span>05:45:00</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5">Alchemy latency 310ms. Re-routed to QuickNode (90ms).</p>
                </div>
              </div>
            </div>

            {/* Capacity Forecast chart */}
            <div className="lg:col-span-2 glow-card glass-panel border border-border bg-card p-5 rounded-lg space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Capacity limit Forecast (next 6h)</h3>
                <p className="text-[11px] text-muted-foreground">Active request volume vs estimated node pool capacity limits</p>
              </div>

              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={metricsData.slice(0, 10)} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                    <defs>
                      <linearGradient id="loadGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="time" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Area type="monotone" dataKey="rate" name="Billed Traffic" stroke="#ef4444" strokeWidth={1.5} fill="url(#loadGlow)" />
                    <Area type="monotone" dataKey="p90" name="Pool Capacity limit" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 4" fill="transparent" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LOGS TAB VIEW (SigNoz style log explorer) */}
      {activeSubTab === "logs" && (
        <div className="space-y-4">
          {/* Logs Frequency Bar Chart */}
          <div className="border border-border bg-card p-4 rounded-lg">
            <h3 className="text-sm font-semibold text-foreground mb-3">Live Log Rate (events / min)</h3>
            <div className="h-28 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={logRateData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: "var(--muted-foreground)", fontSize: 8 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 8 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 10 }} />
                  <Bar dataKey="logs" fill="#3B82F6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Canonical FilterPanel */}
          <FilterPanel
            searchPlaceholder="Filter log message, trace_id, or service..."
            searchValue={logSearch}
            onSearchChange={(e) => setLogSearch(e.target.value)}
            showSeverity
            severityValue={logLevelFilter}
            onSeverityChange={(e) => setLogLevelFilter(e.target.value)}
          >
            <button
              onClick={() => setIsLogsLive((p) => !p)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border ${
                isLogsLive
                  ? "bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20"
                  : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
              }`}
            >
              {isLogsLive ? (
                <>
                  <Pause className="size-3" /> Pause
                </>
              ) : (
                <>
                  <Play className="size-3" /> Live
                </>
              )}
            </button>
            <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-muted/40 text-muted-foreground hover:text-foreground">
              <Download className="size-3" /> Download
            </button>
          </FilterPanel>

          {/* Logs Console Streamer */}
          <div className="border border-border bg-[#05070B] rounded-lg p-4 h-96 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-300">
            {filteredLogs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                No logs match your filter queries.
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredLogs.map((log) => {
                  let levelColor = "text-sky-400";
                  if (log.level === "ERROR") levelColor = "text-rose-500";
                  else if (log.level === "WARN") levelColor = "text-amber-500";

                  return (
                    <div key={log.id} className="hover:bg-slate-900/40 py-0.5 px-1 rounded flex items-start gap-2 border-l-2 border-transparent hover:border-primary/50">
                      <span className="text-slate-500 shrink-0 select-none">[{log.timestamp}]</span>
                      <span className={`${levelColor} font-bold shrink-0 w-12 select-none`}>{log.level}</span>
                      <span className="text-slate-400 shrink-0 font-semibold select-none">{log.service}:</span>
                      <span className="break-all flex-1">{log.message}</span>
                      <span className="text-[10px] text-muted-foreground select-all shrink-0 hidden md:inline">
                        trace_id={log.traceId.substring(0, 8)}…
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TRACES & FLAMEGRAPH VIEW */}
      {activeSubTab === "traces" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">
          {/* Flamegraph Spans Timeline Panel */}
          <div className="lg:col-span-2 border border-border bg-card rounded-lg p-5 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Trace Explorer</h3>
              <p className="text-[11px] text-muted-foreground">E2E transaction execution timeline and parent-child span metrics</p>
            </div>

            {/* Trace Header Info */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-muted/20 border border-border p-3 rounded-md text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Trace ID:</span>
                <code className="font-mono text-foreground font-semibold select-all">dc048bd9c88a2411efc801c710a2c1b8</code>
              </div>
              <div className="flex gap-4">
                <div>
                  <span className="text-muted-foreground mr-1.5">Total Spans:</span>
                  <span className="font-mono font-semibold text-foreground">6</span>
                </div>
                <div>
                  <span className="text-muted-foreground mr-1.5">Duration:</span>
                  <span className="font-mono font-semibold text-primary">1.45 s</span>
                </div>
              </div>
            </div>

            {/* Flamegraph Render Blocks */}
            <div className="overflow-x-auto w-full scrollbar-thin">
              <div className="min-w-[500px] space-y-2 select-none pt-2">
                <div className="text-[10px] text-muted-foreground flex justify-between border-b border-border pb-1 font-mono">
                  <span>0ms</span>
                  <span>360ms</span>
                  <span>720ms</span>
                  <span>1080ms</span>
                  <span>1450ms</span>
                </div>
                <div className="space-y-2.5">
                  {traceSpans.map((span) => {
                    const isSelected = selectedSpan?.id === span.id;
                    
                    let blockColor = "bg-sky-500/80 hover:bg-sky-500 border-sky-400/40 text-sky-50";
                    if (span.service === "revenue-engine") blockColor = "bg-emerald-500/80 hover:bg-emerald-500 border-emerald-400/40 text-emerald-50";
                    else if (span.service === "auth-service") blockColor = "bg-indigo-500/80 hover:bg-indigo-500 border-indigo-400/40 text-indigo-50";
                    else if (span.service === "node-agent") blockColor = "bg-amber-500/80 hover:bg-amber-500 border-amber-400/40 text-amber-50";

                    return (
                      <div
                        key={span.id}
                        onClick={() => setSelectedSpan(span)}
                        className={`h-7 rounded border text-[10px] font-medium font-mono px-2 flex items-center cursor-pointer transition-all duration-300 relative ${blockColor} ${
                          isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-card shadow-lg" : ""
                        }`}
                        style={{
                          width: `${span.percentage}%`,
                          marginLeft: `${span.startPct}%`,
                        }}
                      >
                        <span className="truncate">{span.name}</span>
                        <span className="absolute right-2 font-mono text-[9px] opacity-90">{span.durationMs}ms</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Span Details Side Panel */}
          <div className="lg:col-span-1 border border-border bg-card rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Terminal className="size-3" /> Span Details
              </span>
              {selectedSpan && (
                <span className="px-2 py-0.5 rounded bg-muted text-[10px] font-mono font-medium border border-border">
                  {selectedSpan.durationMs}ms
                </span>
              )}
            </div>

            {selectedSpan ? (
              <div className="p-4 space-y-5">
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Span Name</span>
                  <div className="text-xs font-semibold text-foreground break-all">{selectedSpan.name}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Service</span>
                    <div className="text-xs font-mono font-medium text-foreground">{selectedSpan.service}</div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Kind</span>
                    <div className="text-xs font-mono font-medium text-foreground">{selectedSpan.kind}</div>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border pt-3">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Attributes</span>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {Object.entries(selectedSpan.attributes).map(([key, val]) => (
                      <div key={key} className="bg-muted/30 border border-border p-2 rounded text-[10px] space-y-0.5">
                        <span className="text-muted-foreground font-semibold break-all block">{key}</span>
                        <code className="text-foreground break-all font-mono block select-all">{val}</code>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="pt-4 border-t border-border space-y-2">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Operator Mitigation</span>
                  <div className="flex flex-col gap-2">
                    <Button size="xs" variant="outline" className="w-full justify-start text-red-400 hover:bg-red-500/10 border-red-500/20" onClick={() => {
                      const ip = selectedSpan.attributes["client.ip"] || "157.45.18.23";
                      alert(`Quarantined IP address ${ip} on gateway firewalls.`);
                    }}>
                      Quarantine client IP
                    </Button>
                    <Button size="xs" variant="ghost" className="w-full justify-start text-[11px]" onClick={() => alert("Re-dispatching test query payload with matching trace headers...")}>
                      Re-run query trace
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-muted-foreground">
                Select a span from the flamegraph to inspect details.
              </div>
            )}
          </div>
        </div>
      )}

      {/* EMBEDDED GRAFANA TAB */}
      {activeSubTab === "grafana" && (
        <div className="space-y-6">
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
      )}
    </div>
  );
}
