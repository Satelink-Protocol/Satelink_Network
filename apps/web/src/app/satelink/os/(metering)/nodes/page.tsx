"use client";

import { useState, useMemo } from "react";
import {
  DashboardSection,
  ErrorState,
  LoadingState,
  DataTable,
  type DataTableColumn,
  StatusBadge,
  Button,
  KPIGrid,
  useEndpoint,
  StatCard,
  Badge,
  BarChartPanel,
  LineChartPanel,
  DonutChart,
  Card,
  CardHeader,
  CardContent,
} from "@satelink/ui";
import { Server, Compass, Cpu, HardDrive, ShieldAlert, Zap, LogOut, Monitor, TrendingUp, AlertTriangle } from "lucide-react";

interface NodeRow {
  nodeId: string;
  nodeType: string;
  region: string;
  status: string;
  tier: string;
  registeredAt: string;
  latencyMs?: number;
  reputationScore?: number;
  cpuUsage?: number;
  ramUsage?: number;
  version?: string;
  capacityAvailable?: number;
  revenueContribution?: number;
  fleetHealthScore?: number;
}

interface NodesResponse {
  ok: boolean;
  nodes: NodeRow[];
}

function formatRegistered(ts: string): string {
  const n = parseInt(ts, 10);
  if (Number.isNaN(n)) return ts;
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default function NodesPage() {
  const w = useEndpoint<NodesResponse>(["/api/nodes"]);
  const [selectedNode, setSelectedNode] = useState<NodeRow | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  // Executive layer calculations (memoized for performance)
  const execStats = useMemo(() => {
    if (!w.data) return null;
    const total = w.data.nodes.length;
    const healthy = w.data.nodes.filter((n) => n.status === "active").length;
    const degraded = w.data.nodes.filter((n) => n.status === "degraded").length;
    const capacity = w.data.nodes.reduce((sum, n) => sum + (n.capacityAvailable ?? 0), 0);
    const avgLatency =
      w.data.nodes.reduce((sum, n) => sum + (n.latencyMs ?? 0), 0) / total || 0;
    const revenue = w.data.nodes.reduce((sum, n) => sum + (n.revenueContribution ?? 0), 0);
    const fleetScore =
      w.data.nodes.reduce((sum, n) => sum + (n.fleetHealthScore ?? 0), 0) / total || 0;
    return { total, healthy, degraded, capacity, avgLatency, revenue, fleetScore };
  }, [w.data]);

  const handleNodeAction = (action: string, nodeId: string) => {
    setActing(action);
    setTimeout(() => {
      alert(`Node Action '${action}' successfully triggered on node ${nodeId}`);
      setActing(null);
    }, 800);
  };

  const cols: DataTableColumn<NodeRow>[] = [
    {
      key: "id",
      header: "Node ID",
      cell: (n) => (
        <span
          className="font-mono text-xs font-semibold hover:underline cursor-pointer text-primary"
          onClick={() => setSelectedNode(n)}
        >
          {n.nodeId}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (n) => <StatusBadge status={n.status === "active" ? "active" : "neutral"} label={n.status} /> },
    { key: "region", header: "Region", cell: (n) => <span className="text-xs">{n.region}</span> },
    { key:"tier", header:"Tier", cell:(n)=><Badge variant="outline" className="font-mono text-[10px]">{n.tier}</Badge>},
    { key: "latency", header: "Latency", cell: (n) => <span className="font-mono text-zinc-400">{n.latencyMs ?? "-"}ms</span> },
    { key: "reputation", header: "Reputation", cell: (n) => <span className="font-mono font-semibold text-emerald-400">{n.reputationScore ?? "-"}%</span> },
    {
      key: "actions",
      header: "Actions",
      cell: (n) => (
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="outline" onClick={() => handleNodeAction("PING", n.nodeId)} disabled={acting !== null}>Ping</Button>
          <Button size="xs" variant="outline" onClick={() => handleNodeAction("RESTART", n.nodeId)} disabled={acting !== null}>Restart</Button>
          <Button size="xs" variant="outline" onClick={() => handleNodeAction("DRAIN", n.nodeId)} disabled={acting !== null}>Drain</Button>
          <Button size="xs" variant="outline" onClick={() => handleNodeAction("QUARANTINE", n.nodeId)} disabled={acting !== null} className="text-red-400 border-red-500/20 hover:bg-red-500/10">Quarantine</Button>
          <Button size="xs" variant="outline" onClick={() => handleNodeAction("UPDATE", n.nodeId)} disabled={acting !== null}>Deploy Update</Button>
          <Button size="xs" variant="ghost" onClick={() => alert(`Viewing logs for ${n.nodeId}`)}>Logs</Button>
          <Button size="xs" variant="ghost" onClick={() => alert(`Viewing metrics for ${n.nodeId}`)}>Metrics</Button>
          <Button size="xs" variant="ghost" onClick={() => alert(`Reputation history for ${n.nodeId}`)}>Reputation</Button>
        </div>
      ),
    },
  ];

  // Analytics data preparation
  const latencyDist = useMemo(() => {
    if (!w.data) return [];
    const buckets: Record<string, number> = {};
    w.data.nodes.forEach((n) => {
      const v = n.latencyMs ?? 0;
      const bucket = `${Math.floor(v / 50) * 50}-${Math.floor(v / 50) * 50 + 49}ms`;
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    });
    return Object.entries(buckets).map(([label, count]) => ({ label, value: count }));
  }, [w.data]);

  const regionDist = useMemo(() => {
    if (!w.data) return [];
    const map: Record<string, number> = {};
    w.data.nodes.forEach((n) => {
      map[n.region] = (map[n.region] ?? 0) + 1;
    });
    return Object.entries(map).map(([label, value]) => ({ label, value }));
  }, [w.data]);

  const tierBreakdown = useMemo(() => {
    if (!w.data) return [];
    const map: Record<string, number> = {};
    w.data.nodes.forEach((n) => {
      map[n.tier] = (map[n.tier] ?? 0) + 1;
    });
    return Object.entries(map).map(([label, value]) => ({ label, value }));
  }, [w.data]);

  const capacityUtil = useMemo(() => {
    if (!w.data) return [];
    const totalCap = w.data.nodes.reduce((sum, n) => sum + (n.capacityAvailable ?? 0), 0);
    const usedCap = w.data.nodes.reduce((sum, n) => sum + ((n.capacityAvailable ?? 0) * (n.fleetHealthScore ?? 0) / 100), 0);
    return [
      { label: "Used", value: usedCap },
      { label: "Free", value: Math.max(totalCap - usedCap, 0) },
    ];
  }, [w.data]);

  const reputationTrend = useMemo(() => {
    if (!w.data) return [];
    const sorted = [...w.data.nodes].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
    return sorted.map((n, i) => ({ x: i, y: n.reputationScore ?? 0 }));
  }, [w.data]);

  const earningsByNode = useMemo(() => {
    if (!w.data) return [];
    return w.data.nodes.map((n) => ({ label: n.nodeId, value: n.revenueContribution ?? 0 }));
  }, [w.data]);

  // Determine worst node (lowest fleet health score)
  const worstNode = useMemo(() => {
    if (!w.data) return null;
    return w.data.nodes.reduce((prev, cur) => {
      const curScore = cur.fleetHealthScore ?? 0;
      const prevScore = prev?.fleetHealthScore ?? Infinity;
      return curScore < prevScore ? cur : prev;
    }, null as NodeRow | null);
  }, [w.data]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Executive Layer */}
      {execStats && (
        <KPIGrid columns={4}>
          <StatCard label="Total Nodes" value={execStats.total.toString()} icon={Server} />
          <StatCard label="Healthy Nodes" value={execStats.healthy.toString()} icon={Zap} />
          <StatCard label="Degraded Nodes" value={execStats.degraded.toString()} icon={AlertTriangle} />
          <StatCard label="Capacity Available" value={`${execStats.capacity}%`} icon={Compass} />
          <StatCard label="Avg Latency" value={`${execStats.avgLatency.toFixed(1)}ms`} icon={Cpu} />
          <StatCard label="Revenue Contribution" value={`${execStats.revenue.toFixed(2)} USD`} icon={TrendingUp} />
          <StatCard label="Fleet Health Score" value={`${execStats.fleetScore.toFixed(1)}`} icon={HardDrive} />
        </KPIGrid>
      )}

      {/* Main Nodes Table */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className={selectedNode ? "xl:col-span-2" : "xl:col-span-3"}>
          <DashboardSection
            title="Registered Nodes"
            description="Active decentralized validation nodes on the gateway pool"
            actions={
              <Button size="sm" asChild>
                <a href="/docs">Run a Node</a>
              </Button>
            }
            flush
          >
            <div className="p-4 border-b border-border">
              {w.loading && <LoadingState count={3} />}
              {w.error && <ErrorState title="Unable to load nodes" description={w.error} />}
            </div>
            {w.data && (
              <DataTable
                columns={cols}
                rows={w.data.nodes}
                rowKey={(n) => n.nodeId}
                emptyTitle="No nodes registered yet."
                emptyDescription="Join the network and earn rewards by running a decentralized node."
                emptyAction={
                  <Button size="sm" asChild>
                    <a href="/docs">Read Documentation</a>
                  </Button>
                }
              />
            )}
          </DashboardSection>
        </div>
        {/* Selected Node Detail */}
        {selectedNode && (
          <div className="border border-border bg-card rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Server className="size-3" /> Node Console
              </span>
              <Button size="xs" variant="ghost" onClick={() => setSelectedNode(null)}>
                Close
              </Button>
            </div>
            <div className="p-4 space-y-5">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                  Node Address
                </span>
                <div className="text-xs font-mono font-semibold text-foreground break-all select-all">
                  {selectedNode.nodeId}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
                    <Cpu className="h-3 w-3" /> CPU Load
                  </span>
                  <div className="text-xs font-mono font-semibold text-foreground">
                    {selectedNode.cpuUsage ?? "-"}%
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
                    <HardDrive className="h-3 w-3" /> RAM Load
                  </span>
                  <div className="text-xs font-mono font-semibold text-foreground">
                    {selectedNode.ramUsage ?? "-"}%
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                      Reputation
                    </span>
                    <div className="text-xs font-mono font-semibold text-emerald-400">
                      {selectedNode.reputationScore ?? "-"}%
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                      Latency
                    </span>
                    <div className="text-xs font-mono font-semibold text-foreground">
                      {selectedNode.latencyMs ?? "-"}ms
                    </div>
                  </div>
                </div>
                <div className="pt-4 border-t border-border space-y-2">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">
                    Host Operations
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="xs" variant="outline" onClick={() => handleNodeAction("PING", selectedNode.nodeId)} disabled={acting !== null}>
                      {acting === "PING" ? "Pinging..." : "Ping Host"}
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => handleNodeAction("RESTART", selectedNode.nodeId)} disabled={acting !== null}>
                      {acting === "RESTART" ? "Rebooting..." : "Restart Agent"}
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => handleNodeAction("DRAIN", selectedNode.nodeId)} disabled={acting !== null}>
                      Drain Node
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => handleNodeAction("UPDATE", selectedNode.nodeId)} disabled={acting !== null}>
                      Deploy Update
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => handleNodeAction("QUARANTINE", selectedNode.nodeId)} disabled={acting !== null} className="text-red-400 border-red-500/20 hover:bg-red-500/10">
                      <ShieldAlert className="h-3.5 w-3.5 mr-1" /> Quarantine Node
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => alert(`Viewing logs for ${selectedNode.nodeId}`)}>
                      View Logs
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => alert(`Viewing metrics for ${selectedNode.nodeId}`)}>
                      View Metrics
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => alert(`Reputation history for ${selectedNode.nodeId}`)}>
                      Reputation History
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Analytics Layer */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
        <div className="min-w-0 h-[180px] relative">
          <BarChartPanel
            title="Latency Distribution"
            data={latencyDist.map(d => ({ x: d.label, y: d.value }))}
          />
        </div>
        <div className="min-w-0 h-[180px] relative">
          <DonutChart
            title="Region Distribution"
            data={regionDist.map(d => ({ name: d.label, value: d.value }))}
          />
        </div>
        <div className="min-w-0 h-[180px] relative">
          <DonutChart
            title="Tier Breakdown"
            data={tierBreakdown.map(d => ({ name: d.label, value: d.value }))}
          />
        </div>
        <div className="min-w-0 h-[180px] relative">
          <BarChartPanel
            title="Capacity Utilization"
            data={capacityUtil.map(d => ({ x: d.label, y: d.value }))}
          />
        </div>
        <div className="min-w-0 h-[180px] relative">
          <LineChartPanel
            title="Reputation Trend"
            data={reputationTrend}
          />
        </div>
        <div className="min-w-0 h-[180px] relative">
          <BarChartPanel
            title="Earnings by Node"
            data={earningsByNode.map(d => ({ x: d.label, y: d.value }))}
          />
        </div>
      </div>

      {/* Observability Quick Links */}
      {worstNode && (
        <div className="border border-border bg-card rounded-lg p-4 mt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">Worst Node: {worstNode.nodeId}</h3>
              <p className="text-sm text-muted-foreground">Health Score: {worstNode.fleetHealthScore}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => alert(`Opening trace for ${worstNode.nodeId}`)}>
                Open Trace
              </Button>
              <Button variant="outline" size="sm" onClick={() => alert(`Opening logs for ${worstNode.nodeId}`)}>
                Open Logs
              </Button>
              <Button variant="outline" size="sm" onClick={() => alert(`Opening metrics for ${worstNode.nodeId}`)}>
                Open Metrics
              </Button>
              <Button variant="outline" size="sm" onClick={() => alert(`Opening incident for ${worstNode.nodeId}`)}>
                Open Incident
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
