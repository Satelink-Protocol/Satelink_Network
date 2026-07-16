"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Ban, RefreshCw, UserCheck, HelpCircle, Globe } from "lucide-react";
import {
  Button,
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  Badge,
  type DataTableColumn,
} from "@satelink/ui";
import { adminGet, adminPatch } from "../_lib/adminClient";

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
  recent_blocks: { asn_blocks: number; cluster_blocks: ClusterBlock[] };
}

export default function SOCThreatCenterPage() {
  const [data, setData] = useState<AbuseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminGet<AbuseOverview>("intel/abuse-overview");
    setData(res);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleBlock = async (ip: string) => {
    setActing(ip);
    const res = await adminPatch(`intel/developer/${ip}/stage`, {
      stage: "contacted",
      notes: "Quarantined by SOC block action",
    });
    setActing(null);
    if (res) {
      load();
    } else {
      alert(`Failed to block ${ip}`);
    }
  };

  const abuserCols: DataTableColumn<Abuser>[] = [
    {
      key: "ip",
      header: "Source IP",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs font-bold text-foreground select-all">{r.ip}</span>
          <span className="text-[10px] text-muted-foreground">{[r.country, r.isp].filter(Boolean).join(" · ") || "—"}</span>
        </div>
      ),
    },
    {
      key: "user_agent",
      header: "User Agent",
      cell: (r) => <span className="text-xs text-muted-foreground font-mono truncate max-w-[220px] block">{r.user_agent || "unknown"}</span>,
    },
    { key: "calls_today", header: "Calls Today", align: "right", cell: (r) => <span className="font-mono text-xs">{Number(r.calls_today).toLocaleString()}</span> },
    {
      key: "score",
      header: "Risk",
      align: "right",
      cell: (r) => (
        <Badge className={(r.score > 70 ? "bg-red-500/15 text-red-400 border-red-500/30" : "bg-orange-500/15 text-orange-400 border-orange-500/30") + " text-[10px]"}>
          {r.score}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <Button size="xs" variant="outline" className="text-red-400 hover:bg-red-500/10 border-red-500/20" disabled={acting !== null} onClick={() => handleBlock(r.ip)}>
          <Ban className="size-3 mr-1" /> {acting === r.ip ? "…" : "Block"}
        </Button>
      ),
    },
  ];

  const subnetCols: DataTableColumn<Subnet>[] = [
    { key: "subnet", header: "Subnet", cell: (r) => <span className="font-mono text-xs font-bold text-foreground">{r.subnet}</span> },
    { key: "ip_count", header: "Unique IPs", align: "right", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.ip_count}</span> },
    { key: "total_calls_today", header: "Calls Today", align: "right", cell: (r) => <span className="font-mono text-xs">{Number(r.total_calls_today).toLocaleString()}</span> },
  ];

  const s = data?.summary;
  const blockCount = (s?.blocked_asns || 0) + (s?.blocked_clusters || 0);
  const clusterBlocks = data?.recent_blocks?.cluster_blocks ?? [];

  return (
    <div className="space-y-6">
      <KPIGrid columns={4}>
        <StatCard label="Active Quarantine Blocks" value={data ? String(blockCount) : "—"} caption="Blocked ASNs + UA clusters" icon={ShieldAlert} accent={blockCount > 0} loading={loading} />
        <StatCard label="Machines + Scanners" value={data ? String((s!.machines || 0) + (s!.scanners || 0)) : "—"} caption="Non-developer classified traffic" icon={ShieldAlert} loading={loading} />
        <StatCard label="Developer Leads" value={data ? String(s!.developers) : "—"} caption="Potential customers" icon={UserCheck} loading={loading} accent={(s?.developers ?? 0) > 0} />
        <StatCard label="Unknown Traffic" value={data ? String(s!.unknown) : "—"} caption="Unclassified identities" icon={HelpCircle} loading={loading} />
      </KPIGrid>

      <DashboardSection
        title="Top Suspicious IPs"
        description="Highest-volume non-developer identities from the classifier"
        actions={
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
        flush
      >
        <DataTable
          columns={abuserCols}
          rows={data?.top_abusers ?? null}
          rowKey={(r) => r.ip}
          loading={loading}
          emptyTitle="No suspicious IPs"
          emptyDescription="No non-developer IPs are over the abuse threshold."
        />
      </DashboardSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DashboardSection title="Subnet Hotspots" description="Subnets with dense concurrent IP activity" flush>
          <DataTable
            columns={subnetCols}
            rows={data?.subnet_hotspots ?? null}
            rowKey={(r) => r.subnet}
            loading={loading}
            emptyTitle="No hotspots"
            emptyDescription="No subnet hotspots detected."
          />
        </DashboardSection>

        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Active Cluster Blocks</h3>
              <p className="text-[11px] text-muted-foreground">User-agent cluster signatures quarantined in Redis</p>
            </div>
            <Globe className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {loading ? (
              <div className="text-center text-xs text-muted-foreground py-8">Loading…</div>
            ) : clusterBlocks.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-8">No cluster blocks active.</div>
            ) : (
              clusterBlocks.map((b, i) => (
                <div key={i} className="p-3 bg-muted/20 border border-border rounded flex items-center justify-between text-xs font-mono">
                  <span className="text-foreground font-bold truncate max-w-[180px]">{b.ua_slug}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {b.ip_count} IPs · TTL {Math.max(0, Math.round(b.ttl_seconds / 60))}m
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
