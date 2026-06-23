"use client";

import { useCallback, useEffect, useState } from "react";
import { UserCheck, ShieldAlert, Ban, HelpCircle, ChevronDown, ChevronRight } from "lucide-react";
import {
  Badge,
  DataTable,
  DashboardSection,
  KPIGrid,
  StatCard,
  type DataTableColumn,
} from "@satelink/ui";

interface IntelRow {
  ip: string;
  user_agent: string | null;
  classification: string;
  score: number;
  calls_today: number;
  avg_daily_calls: number;
  country: string | null;
  isp: string | null;
  first_seen?: string;
}

interface SubnetHotspot {
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
  summary: {
    total_classified: number;
    developers: number;
    machines: number;
    scanners: number;
    unknown: number;
    blocked_asns: number;
    blocked_clusters: number;
  };
  top_abusers: IntelRow[];
  developer_leads: IntelRow[];
  subnet_hotspots: SubnetHotspot[];
  recent_blocks: {
    asn_blocks: number;
    cluster_blocks: ClusterBlock[];
  };
}

const REFRESH_MS = 30_000;

// Shows only the first two octets so the page never displays a full client IP.
function maskIp(ip: string): string {
  const parts = ip.split(".");
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.**.**`;
}

function scoreTone(score: number): string {
  if (score > 60) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-zinc-500";
}

const CLASSIFICATION_TONE: Record<string, string> = {
  machine: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  scanner: "bg-red-500/15 text-red-400 border-red-500/30",
  crawler: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  unknown: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

async function adminFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, method: "GET" }),
    });
    const data = await res.json();
    return data?.ok ? (data as T) : null;
  } catch {
    return null;
  }
}

export default function AdminAbusePage() {
  const [data, setData] = useState<AbuseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [clusterOpen, setClusterOpen] = useState(true);

  const load = useCallback(async () => {
    const overview = await adminFetch<AbuseOverview>("intel/abuse-overview");
    setData(overview);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => clearInterval(iv);
  }, [load]);

  const summary = data?.summary;
  const developerLeads = data?.developer_leads ?? null;
  const topAbusers = data?.top_abusers ?? null;
  const subnetHotspots = data?.subnet_hotspots ?? [];
  const clusterBlocks = data?.recent_blocks?.cluster_blocks ?? [];
  const maxSubnetCalls = Math.max(1, ...subnetHotspots.map((s) => s.total_calls_today));

  const leadColumns: DataTableColumn<IntelRow>[] = [
    { key: "ip", header: "IP", cell: (r) => <span className="font-mono text-xs">{maskIp(r.ip)}</span> },
    { key: "user_agent", header: "User Agent", cell: (r) => <span className="text-xs">{r.user_agent || "unknown"}</span> },
    { key: "calls_today", header: "Calls Today", cell: (r) => r.calls_today, align: "right" },
    { key: "avg_daily_calls", header: "Avg Daily", cell: (r) => r.avg_daily_calls, align: "right" },
    { key: "country", header: "Country", cell: (r) => r.country || "—" },
    {
      key: "first_seen",
      header: "First Seen",
      cell: (r) => (r.first_seen ? new Date(r.first_seen).toLocaleDateString() : "—"),
      align: "right",
    },
    {
      key: "score",
      header: "Score",
      cell: (r) => <span className={`font-mono ${scoreTone(r.score)}`}>{r.score}</span>,
      align: "right",
    },
  ];

  const abuserColumns: DataTableColumn<IntelRow>[] = [
    { key: "ip", header: "IP", cell: (r) => <span className="font-mono text-xs">{maskIp(r.ip)}</span> },
    { key: "user_agent", header: "User Agent", cell: (r) => <span className="text-xs">{r.user_agent || "unknown"}</span> },
    {
      key: "classification",
      header: "Classification",
      cell: (r) => (
        <Badge className={CLASSIFICATION_TONE[r.classification] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"}>
          {r.classification}
        </Badge>
      ),
    },
    { key: "calls_today", header: "Calls Today", cell: (r) => r.calls_today, align: "right" },
    { key: "avg_daily_calls", header: "Avg Daily", cell: (r) => r.avg_daily_calls, align: "right" },
    { key: "country", header: "Country", cell: (r) => r.country || "—" },
  ];

  return (
    <div className="space-y-8">
      <KPIGrid columns={4}>
        <StatCard label="Developer Leads" value={summary?.developers ?? "—"} icon={UserCheck} accent loading={loading} />
        <StatCard
          label="Active Abusers"
          value={summary ? summary.machines + summary.scanners : "—"}
          icon={ShieldAlert}
          loading={loading}
        />
        <StatCard label="Blocked Clusters" value={summary?.blocked_clusters ?? "—"} icon={Ban} loading={loading} />
        <StatCard label="Unknown Traffic" value={summary?.unknown ?? "—"} icon={HelpCircle} loading={loading} />
      </KPIGrid>

      <DashboardSection title="Developer Leads — Potential Customers">
        <DataTable
          columns={leadColumns}
          rows={developerLeads}
          rowKey={(r) => r.ip}
          loading={loading}
          emptyTitle="No developer leads"
          emptyDescription="No IPs have been classified as developer traffic yet."
        />
      </DashboardSection>

      <DashboardSection title="Active Abusers — Blocked/Monitored">
        <DataTable
          columns={abuserColumns}
          rows={topAbusers}
          rowKey={(r) => r.ip}
          loading={loading}
          emptyTitle="No active abusers"
          emptyDescription="No non-developer IPs are currently over the abuse threshold."
        />
      </DashboardSection>

      <DashboardSection title="Subnet Hotspots — IP Rotation Detection">
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : subnetHotspots.length === 0 ? (
          <p className="text-sm text-zinc-500">No subnet hotspots detected.</p>
        ) : (
          <div className="space-y-3">
            {subnetHotspots.map((s) => {
              const rotationRisk = s.ip_count > 5;
              const widthPct = Math.round((s.total_calls_today / maxSubnetCalls) * 100);
              return (
                <div key={s.subnet} className={rotationRisk ? "rounded-md border border-red-500/30 bg-red-500/5 p-3" : "rounded-md border border-zinc-800 p-3"}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono">{s.subnet}</span>
                    <span className={rotationRisk ? "text-red-400" : "text-zinc-400"}>
                      {s.ip_count} IPs · {s.total_calls_today} calls today
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={rotationRisk ? "h-full bg-red-500" : "h-full bg-emerald-500"}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DashboardSection>

      <DashboardSection
        title="Active Cluster Blocks"
        actions={
          <button
            type="button"
            onClick={() => setClusterOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            {clusterOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {clusterOpen ? "Collapse" : "Expand"}
          </button>
        }
      >
        {clusterOpen && (
          loading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : clusterBlocks.length === 0 ? (
            <p className="text-sm text-zinc-500">No active cluster blocks.</p>
          ) : (
            <ul className="space-y-2">
              {clusterBlocks.map((c) => (
                <li
                  key={c.ua_slug}
                  className="flex items-center justify-between rounded-md border border-orange-500/30 bg-orange-500/5 p-3 text-sm"
                >
                  <span className="font-mono text-xs text-orange-300">{c.ua_slug}</span>
                  <span className="text-zinc-400">
                    {c.ip_count} IPs · expires in {Math.max(0, Math.round(c.ttl_seconds / 60))}m
                  </span>
                </li>
              ))}
            </ul>
          )
        )}
      </DashboardSection>
    </div>
  );
}
