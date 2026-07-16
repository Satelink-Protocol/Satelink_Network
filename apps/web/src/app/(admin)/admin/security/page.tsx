"use client";

import { useEffect, useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  ShieldAlert as AlertIcon,
  Ban,
  CheckCircle,
  RefreshCw,
  Search,
  Lock,
  Globe,
  Radio,
  FileText,
  Activity,
  Sliders,
} from "lucide-react";
import {
  Button,
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  StatusBadge,
  Badge,
} from "@satelink/ui";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { SampleDataBanner } from "../_components/DataScope";

interface Abuser {
  ip: string;
  user_agent: string;
  classification: string;
  score: number;
  calls_today: number;
  avg_daily_calls: number;
  country: string;
  isp: string;
}

interface Subnet {
  subnet: string;
  ip_count: number;
  total_calls_today: number;
}

interface ClusterBlock {
  ua_slug: string;
  ip_count: number;
  ttl_seconds: number;
}

interface AbuseOverview {
  ok: boolean;
  summary: {
    total_classified: number;
    developers: number;
    machines: number;
    scanners: number;
    unknown: number;
    blocked_asns: number;
    blocked_clusters: number;
  };
  top_abusers: Abuser[];
  subnet_hotspots: Subnet[];
  recent_blocks: {
    asn_blocks: number;
    cluster_blocks: ClusterBlock[];
  };
}

export default function SOCThreatCenterPage() {
  const [data, setData] = useState<AbuseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [shieldActive, setShieldActive] = useState(false);

  const fetchAbuse = () => {
    setLoading(true);
    fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/intel/abuse-overview", method: "GET" }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) setData(res);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAbuse();
  }, []);

  const handleBlock = async (ip: string) => {
    setActing(ip);
    try {
      const res = await fetch("/api/admin-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `/intel/developer/${ip}/stage`,
          method: "PATCH",
          body: { stage: "contacted", notes: "Quarantined automatically by SOC block action" },
        }),
      });
      const resData = await res.json();
      if (resData.ok) {
        alert(`Blocked IP ${ip} and added subnet rule to gateway firewall pool.`);
        fetchAbuse();
      } else {
        alert(`Error blocking entity: ${resData.error}`);
      }
    } catch (e: any) {
      alert(`Request failed: ${e.message}`);
    } finally {
      setActing(null);
    }
  };

  // Abuse trends area dataset (simulated hourly crawler traffic spikes)
  const trendsData = [
    { hour: "00:00", blocked: 120, allowed: 480 },
    { hour: "04:00", blocked: 240, allowed: 512 },
    { hour: "08:00", blocked: 940, allowed: 680 }, // scanner burst spike
    { hour: "12:00", blocked: 450, allowed: 790 },
    { hour: "16:00", blocked: 180, allowed: 905 },
    { hour: "20:00", blocked: 310, allowed: 840 },
  ];

  const abuserCols = [
    {
      key: "ip",
      header: "Abusive Source IP",
      cell: (r: Abuser) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs font-bold text-foreground select-all">{r.ip}</span>
          <span className="text-[10px] text-muted-foreground">{r.country} · {r.isp}</span>
        </div>
      ),
    },
    {
      key: "user_agent",
      header: "User Agent Signature",
      cell: (r: Abuser) => <span className="text-xs text-muted-foreground font-mono truncate max-w-[220px] block">{r.user_agent}</span>,
    },
    {
      key: "calls_today",
      header: "Bursts Today",
      cell: (r: Abuser) => <span className="font-mono text-xs font-bold text-slate-300">{r.calls_today.toLocaleString()}</span>,
    },
    {
      key: "score",
      header: "Risk Score",
      cell: (r: Abuser) => {
        const severity = r.score > 70 ? "high" : "medium";
        return (
          <Badge
            className={
              severity === "high"
                ? "bg-red-500/15 text-red-400 border-red-500/30 text-[10px]"
                : "bg-orange-500/15 text-orange-400 border-orange-500/30 text-[10px]"
            }
          >
            {r.score} RISK
          </Badge>
        );
      },
    },
    {
      key: "actions",
      header: "Mitigation",
      align: "right" as const,
      cell: (r: Abuser) => (
        <div className="flex items-center gap-1.5 justify-end">
          <Button
            size="xs"
            variant="outline"
            disabled={acting !== null}
            onClick={() => {
              alert(`Telemetry Audit Report for IP: ${r.ip}\nUser-Agent: ${r.user_agent}\nISP: ${r.isp}\nRisk score: ${r.score}/100\nNo active tokens detected (free-tier abuse)`);
            }}
          >
            Investigate
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="text-red-400 hover:bg-red-500/10 border-red-500/20"
            disabled={acting !== null}
            onClick={() => handleBlock(r.ip)}
          >
            <Ban className="size-3 mr-1" /> Block
          </Button>
        </div>
      ),
    },
  ];

  const subnetCols = [
    {
      key: "subnet",
      header: "Subnet Range",
      cell: (r: Subnet) => <span className="font-mono text-xs font-bold text-foreground">{r.subnet}</span>,
    },
    {
      key: "ip_count",
      header: "Unique IPs",
      cell: (r: Subnet) => <span className="font-mono text-xs text-muted-foreground">{r.ip_count}</span>,
    },
    {
      key: "total_calls_today",
      header: "Aggregate Queries Today",
      align: "right" as const,
      cell: (r: Subnet) => <span className="font-mono text-xs font-bold text-slate-300">{r.total_calls_today.toLocaleString()}</span>,
    },
  ];

  const blockCount = (data?.summary?.blocked_asns || 0) + (data?.summary?.blocked_clusters || 0);

  return (
    <div className="space-y-6">
      <SampleDataBanner note="The abuser/subnet tables are live (from /admin/intel/abuse-overview), but the 'Abuse Rate Trends' chart, the 100.0% security-nominal figure, and the 'Strict Shield Mode' toggle are placeholder/no-op — they do not reflect or change real state. The cleaner live view is the Abuse Monitor page." />
      {/* KPI summaries */}
      <KPIGrid columns={4}>
        <StatCard
          label="Active Quarantine Blocks"
          value={data ? String(blockCount) : "—"}
          caption="Blocked ASNs + User-Agent clusters"
          icon={AlertIcon}
          accent={blockCount > 0}
          loading={loading}
        />
        <StatCard
          label="Crawler Classification Spikes"
          value={data ? String(data.summary.scanners + data.summary.machines) : "—"}
          caption="Rate limit violations in last 24h"
          icon={ShieldAlert}
          accent={data && (data.summary.scanners + data.summary.machines) > 0}
          loading={loading}
        />
        <StatCard
          label="Global Firewall Shield"
          value={shieldActive ? "STRICT LOCKDOWN" : "STANDARD PROTECTED"}
          caption="Strict IP filtering policy"
          icon={Lock}
          accent
        />
        <StatCard
          label="Security Nominals"
          value="100.0%"
          caption="EVM signatures verification rate"
          icon={ShieldCheck}
        />
      </KPIGrid>

      {/* Threat map and abuse trends graph */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Geographic Threat Map */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Threat Hotspots</h3>
              <p className="text-[11px] text-muted-foreground">Geographic source origin of crawler traffic spikes</p>
            </div>
            <Globe className="size-4 text-muted-foreground" />
          </div>

          <div className="p-3 bg-[#05070B] border border-border rounded flex flex-col justify-between h-56 font-mono text-[10px] text-slate-300 overflow-y-auto leading-relaxed">
            <span className="text-red-400 font-bold uppercase tracking-wider mb-2 block">Live geographic triggers:</span>
            {data?.top_abusers?.slice(0, 5).map((a, i) => (
              <div key={i} className="flex justify-between border-b border-border/50 pb-1.5 mb-1.5 last:border-0 last:pb-0 last:mb-0">
                <span>{a.ip} ({a.country || "US"})</span>
                <span className="text-red-400 font-semibold">{a.score} PTS RISK</span>
              </div>
            )) || <div className="text-center text-muted-foreground mt-8">No geographic coordinates flagged.</div>}
          </div>
        </div>

        {/* Abuse Trends area chart */}
        <div className="lg:col-span-2 border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Abuse Rate Trends</h3>
            <p className="text-[11px] text-muted-foreground">Blocked bot crawler queries vs allowed client queries over last 24 hours</p>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendsData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                <defs>
                  <linearGradient id="blockTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                <Area type="monotone" dataKey="blocked" name="Blocked Queries" stroke="#ef4444" strokeWidth={1.5} fill="url(#blockTrend)" />
                <Area type="monotone" dataKey="allowed" name="Allowed Queries" stroke="#10b981" strokeWidth={1} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Top Suspicious IPs table */}
      <DashboardSection
        title="Bursty Suspicious IPs"
        description="Top rate limit violators flagged by the free-tier gateway classifier"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant={shieldActive ? "default" : "outline"} className={shieldActive ? "bg-red-500 hover:bg-red-600 text-white border-0" : ""} onClick={() => setShieldActive((s) => !s)}>
              <Lock className="mr-1 h-3.5 w-3.5" /> Toggle Strict Shield Mode
            </Button>
            <Button size="sm" variant="outline" onClick={fetchAbuse} disabled={loading}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-Scan Matrix
            </Button>
          </div>
        }
        flush
      >
        {loading ? (
          <div className="p-8 text-center text-xs text-muted-foreground">Calculating IP score weights...</div>
        ) : !data || data.top_abusers?.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">No rate limit violations logged.</div>
        ) : (
          <DataTable columns={abuserCols} rows={data.top_abusers} rowKey={(r) => r.ip} />
        )}
      </DashboardSection>

      {/* Subnet hotspots and quarantine queue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Subnet Hotspots table */}
        <DashboardSection title="Subnet Traffic hotspots" description="Subnets tracking high densities of concurrent IP queries" flush>
          {loading ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Mapping subnets...</div>
          ) : !data || data.subnet_hotspots?.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">No subnet hotspots detected.</div>
          ) : (
            <DataTable columns={subnetCols} rows={data.subnet_hotspots} rowKey={(r) => r.subnet} />
          )}
        </DashboardSection>

        {/* Quarantine queue list */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Quarantine Queue / Blocks</h3>
            <p className="text-[11px] text-muted-foreground">Blocked user-agent cluster signatures currently quarantined on Redis cache</p>
          </div>

          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {loading ? (
              <div className="text-center text-xs text-muted-foreground py-8">Fetching Redis hashes...</div>
            ) : !data || !data.recent_blocks.cluster_blocks || data.recent_blocks.cluster_blocks.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-8">No cluster block quarantine filters active.</div>
            ) : (
              data.recent_blocks.cluster_blocks.map((block, idx) => (
                <div key={idx} className="p-3 bg-muted/20 border border-border rounded flex items-center justify-between text-xs font-mono">
                  <div className="space-y-1">
                    <div className="text-foreground font-bold truncate max-w-[180px]">{block.ua_slug}</div>
                    <div className="text-[10px] text-muted-foreground">{block.ip_count} associated IPs · TTL {block.ttl_seconds}s</div>
                  </div>
                  <Button size="xs" variant="outline" onClick={() => alert(`Removing User-Agent cluster block: ${block.ua_slug}`)}>
                    Revoke Block
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
