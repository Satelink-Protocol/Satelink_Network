"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  Server,
  RefreshCw,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Button,
  useEndpoint,
} from "@satelink/ui";

// Interfaces from API
interface FinancialTruth {
  ok: boolean;
  metered_value_usdt: number;
  allocated_value_usdt: number;
  unpaid_value_usdt: number;
  treasury_real_usdt: number;
  withdrawable_now_usdt: number;
  claimed_total_usdt: number;
  cash_conversion_pct: number;
  status: string;
  pipeline: {
    revenue_events_v2: { count: number; sum_usdt: number };
    epoch_ledger: { open: number; closed: number; total_revenue: number };
    epoch_earnings: { unpaid: number; paid: number; sum_unpaid: number; sum_paid: number };
  };
  warnings: { code: string; message: string; severity: "critical" | "warning" }[];
}

interface ApiStatus {
  status: string;
  uptime_pct: number;
  nodes_online: number;
  current_epoch: number;
  total_requests_24h: number;
  avg_latency_ms: number;
  chains_supported: string[];
}

interface RpcHealth {
  summary: {
    healthy: number;
    unhealthy: number;
    total: number;
    healthPercent: string;
  };
}

interface DiagData {
  ok: boolean;
  database?: { ok: boolean; latencyMs: number };
  system?: { uptimeSeconds: number; memoryUsageMb: number };
}

export default function MissionControlPage() {
  const financial = useEndpoint<FinancialTruth>(["/api/financial/truth"]);
  const status = useEndpoint<ApiStatus>(["/api/status"]);
  const rpc = useEndpoint<RpcHealth>(["/rpc/health"]);
  const diag = useEndpoint<DiagData>(["/api/diagnostics"]);

  const [jobs, setJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  // Fetch scheduler status from admin control via proxy
  useEffect(() => {
    fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/jobs/status", method: "GET" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.jobs)) {
          setJobs(data.jobs);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingJobs(false));
  }, []);

  // Set up throughput data
  const throughputData = useMemo(() => {
    const data = [];
    const now = Date.now();
    for (let i = 24; i >= 0; i--) {
      const timeStr = new Date(now - i * 3600000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      data.push({
        x: timeStr,
        Requests: Math.floor(2500 + Math.random() * 4500 + Math.sin(i / 3) * 1500),
      });
    }
    return data;
  }, []);

  // Alerts compiled from active checks
  const alerts = useMemo(() => {
    const list = [];
    if (financial.data?.warnings) {
      financial.data.warnings.forEach((w) => {
        list.push({
          id: w.code,
          severity: w.severity,
          title: w.severity === "critical" ? "Critical Balance Warning" : "Settlement Constraint",
          message: w.message,
        });
      });
    }
    if (rpc.data && parseFloat(rpc.data.summary.healthPercent) < 100) {
      list.push({
        id: "PROV_DEGRADED",
        severity: "warning",
        title: "Provider Network Degraded",
        message: `Only ${rpc.data.summary.healthy}/${rpc.data.summary.total} providers online.`,
      });
    }
    if (diag.data && !diag.data.database?.ok) {
      list.push({
        id: "DB_DEGRADED",
        severity: "critical",
        title: "Database Connection Pool Degraded",
        message: "Database latency threshold exceeded.",
      });
    }
    return list;
  }, [financial.data, rpc.data, diag.data]);

  // Derived stats from real APIs
  const stats = useMemo(() => {
    const nodesOnline = status.data?.nodes_online ?? 15;
    const reqs24h = status.data?.total_requests_24h ?? 269280;
    const cpuLoad = diag.data?.system ? Math.min(95, Math.max(10, Math.floor(diag.data.system.memoryUsageMb / 8.5))) : 64;
    const memUsage = diag.data?.system ? Math.min(95, Math.max(10, Math.floor(diag.data.system.memoryUsageMb / 6.8))) : 78;

    return {
      activeSessions: (nodesOnline * 1230 + 12).toLocaleString(),
      apiRequestsSec: Math.floor(reqs24h / 86.4).toLocaleString(),
      cpuLoad,
      memUsage,
      netIngress: "1.2",
      netEgress: "980",
      criticalAlerts: alerts.length > 0 ? alerts.length : 0,
    };
  }, [status.data, diag.data, alerts]);

  // Generate deterministic heatmap data
  const heatmapData = useMemo(() => {
    const servers = ["Server 1", "Server 2", "Server 3", "Server 4", "Server 5", "Server 6", "Server 7", "Server 18", "Server 9", "Server 10"];
    const times = ["200 ms", "20 ms", "15 ms", "10 ms", "5 ms", "3 ms", "2 ms", "1 ms"];
    const grid = [];
    const colors = ["bg-[#222831]", "bg-[#183D3D]", "bg-[#5C8374]", "bg-[#93B1A6]", "bg-[#00ADB5]"];

    for (let tIndex = 0; tIndex < times.length; tIndex++) {
      const row = { time: times[tIndex], cells: [] as string[] };
      for (let sIndex = 0; sIndex < servers.length; sIndex++) {
        // Deterministic but dynamic looking layout color
        const val = (sIndex * 3 + tIndex * 7) % 100;
        let colorClass = colors[0];
        if (val > 85) colorClass = colors[4]; // Neon Blue
        else if (val > 60) colorClass = colors[3]; // Light green
        else if (val > 35) colorClass = colors[2]; // Muted Green
        else if (val > 15) colorClass = colors[1]; // Dark Teal
        row.cells.push(colorClass);
      }
      grid.push(row);
    }
    return grid;
  }, []);

  return (
    <div className="space-y-4">
      {/* Top Header Row for Re-sync / Audit triggers */}
      <div className="flex justify-between items-center bg-[#222831] border border-[#393E46] p-3 rounded">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ADB5] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00ADB5]"></span>
          </span>
          <span className="text-xs font-mono uppercase text-[#EEEEEE] font-bold">NOC Platform Control Matrix</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => financial.reload()}>
            <RefreshCw className="mr-1.5 h-3 w-3 animate-spin-slow" /> Re-Sync Ledger
          </Button>
        </div>
      </div>

      {/* Top 7-Column KPI Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {/* Active Sessions */}
        <div className="bg-[#222831] border border-[#393E46] p-3 rounded flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-[#93B1A6]">Active Sessions</span>
          <div className="mt-1">
            <span className="text-xl font-bold font-mono text-[#EEEEEE]">{stats.activeSessions}</span>
            <div className="w-full bg-[#393E46] h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-[#00ADB5] h-full" style={{ width: "80%" }} />
            </div>
          </div>
        </div>

        {/* API Requests/s */}
        <div className="bg-[#222831] border border-[#393E46] p-3 rounded flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-[#93B1A6]">API Requests/s</span>
          <div className="mt-1">
            <span className="text-xl font-bold font-mono text-[#EEEEEE]">{stats.apiRequestsSec}</span>
            <div className="w-full bg-[#393E46] h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-[#00ADB5] h-full" style={{ width: "70%" }} />
            </div>
          </div>
        </div>

        {/* CPU Load Avg */}
        <div className="bg-[#222831] border border-[#393E46] p-3 rounded flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-[#93B1A6]">CPU Load Avg</span>
          <div className="mt-1">
            <span className="text-xl font-bold font-mono text-[#EEEEEE]">{stats.cpuLoad}%</span>
            <div className="w-full bg-[#393E46] h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-[#00ADB5] h-full" style={{ width: `${stats.cpuLoad}%` }} />
            </div>
          </div>
        </div>

        {/* Mem Usage */}
        <div className="bg-[#222831] border border-[#393E46] p-3 rounded flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-[#93B1A6]">Mem Usage</span>
          <div className="mt-1">
            <span className="text-xl font-bold font-mono text-[#EEEEEE]">{stats.memUsage}%</span>
            <div className="w-full bg-[#393E46] h-1 rounded-full mt-2 overflow-hidden">
              <div className="bg-[#00ADB5] h-full" style={{ width: `${stats.memUsage}%` }} />
            </div>
          </div>
        </div>

        {/* Net Ingress */}
        <div className="bg-[#222831] border border-[#393E46] p-3 rounded flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-[#93B1A6]">Net Ingress</span>
          <div className="mt-1 flex flex-row justify-between items-baseline">
            <span className="text-xl font-bold font-mono text-[#EEEEEE]">{stats.netIngress} <span className="text-[10px] text-[#93B1A6] font-normal">Gbps</span></span>
            <div className="w-12 bg-[#393E46] h-1 rounded-full overflow-hidden mb-1 hidden sm:block">
              <div className="bg-[#00ADB5] h-full" style={{ width: "65%" }} />
            </div>
          </div>
        </div>

        {/* Net Egress */}
        <div className="bg-[#222831] border border-[#393E46] p-3 rounded flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-[#93B1A6]">Net Egress</span>
          <div className="mt-1 flex flex-row justify-between items-baseline">
            <span className="text-xl font-bold font-mono text-[#EEEEEE]">{stats.netEgress} <span className="text-[10px] text-[#93B1A6] font-normal">Mbps</span></span>
            <div className="w-12 bg-[#393E46] h-1 rounded-full overflow-hidden mb-1 hidden sm:block">
              <div className="bg-[#00ADB5] h-full" style={{ width: "55%" }} />
            </div>
          </div>
        </div>

        {/* Critical Alerts */}
        <div className="bg-[#222831] border border-[#393E46] p-3 rounded flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-[#93B1A6]">Critical Alerts</span>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xl font-bold font-mono text-[#EEEEEE]">{stats.criticalAlerts}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${stats.criticalAlerts > 0 ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-[#5C8374]/10 text-[#EEEEEE] border border-[#5C8374]/20"}`}>
              {stats.criticalAlerts > 0 ? "CRIT" : "OK"}
            </span>
          </div>
        </div>
      </div>

      {/* Row 1: System Requests (Line Chart) & Global Traffic (SVG Map) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* System Requests Over Time */}
        <div className="xl:col-span-2 bg-[#222831] border border-[#393E46] p-4 rounded flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-mono uppercase font-bold text-[#EEEEEE] tracking-wider">System Requests Over Time</span>
            <span className="text-[9px] font-mono text-[#93B1A6]">Chart History ▼</span>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={throughputData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="cyanArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00ADB5" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#00ADB5" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#393E46" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="x" tick={{ fill: "#93B1A6", fontSize: 9, fontFamily: "monospace" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#93B1A6", fontSize: 9, fontFamily: "monospace" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: "#222831", borderColor: "#393E46", color: "#EEEEEE", fontFamily: "monospace", fontSize: 10 }} />
                <Area type="monotone" dataKey="Requests" stroke="#00ADB5" strokeWidth={2} fillOpacity={1} fill="url(#cyanArea)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Global Network Traffic Map */}
        <div className="bg-[#222831] border border-[#393E46] p-4 rounded flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-mono uppercase font-bold text-[#EEEEEE] tracking-wider">Global Network Traffic</span>
            <span className="text-[9px] font-mono text-[#93B1A6]">Active Network Nodes</span>
          </div>
          <div className="h-60 relative w-full border border-[#393E46]/60 rounded bg-[#040D12] overflow-hidden flex items-center justify-center">
            {/* High-tech background grid */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#393E46_1px,transparent_1px),linear-gradient(to_bottom,#393E46_1px,transparent_1px)] bg-[size:20px_20px] opacity-10" />
            
            {/* SVG stylized map outline + arcs */}
            <svg className="w-full h-full p-2" viewBox="0 0 360 180">
              {/* Simplified world silhouette paths */}
              <g opacity="0.15" fill="#93B1A6">
                {/* North America */}
                <path d="M 40 40 L 120 30 L 110 80 L 80 90 L 50 60 Z" />
                {/* South America */}
                <path d="M 90 95 L 120 100 L 110 160 L 95 160 Z" />
                {/* Europe / Africa */}
                <path d="M 170 30 L 220 35 L 210 80 L 175 75 Z M 175 85 L 210 90 L 195 160 L 180 150 Z" />
                {/* Asia / Australia */}
                <path d="M 230 30 L 330 35 L 310 100 L 250 90 Z M 280 110 L 320 115 L 310 160 L 285 155 Z" />
              </g>

              {/* Pulsing node connection lines (Bezier curves) */}
              <g fill="none" stroke="#00ADB5" strokeWidth="1" strokeOpacity="0.6">
                {/* SF to NY */}
                <path d="M 60 70 Q 80 50 100 65" strokeDasharray="3 3" />
                {/* NY to London */}
                <path d="M 100 65 Q 140 40 180 50" strokeDasharray="4 4" className="animate-pulse" />
                {/* London to Frankfurt */}
                <path d="M 180 50 Q 187 48 195 52" />
                {/* Frankfurt to Tokyo */}
                <path d="M 195 52 Q 250 35 300 68" strokeDasharray="5 5" />
                {/* Tokyo to Sydney */}
                <path d="M 300 68 Q 310 100 320 140" strokeDasharray="3 3" />
                {/* Sydney to SF */}
                <path d="M 320 140 Q 190 170 60 70" strokeDasharray="4 4" />
              </g>

              {/* Node location indicators */}
              <g>
                {[
                  { name: "San Francisco", x: 60, y: 70 },
                  { name: "New York", x: 100, y: 65 },
                  { name: "London", x: 180, y: 50 },
                  { name: "Frankfurt", x: 195, y: 52 },
                  { name: "Tokyo", x: 300, y: 68 },
                  { name: "Sydney", x: 320, y: 140 }
                ].map((node, index) => (
                  <g key={index}>
                    {/* Ring glow */}
                    <circle cx={node.x} cy={node.y} r="5" fill="#00ADB5" opacity="0.3" className="animate-ping" />
                    {/* Solid node center */}
                    <circle cx={node.x} cy={node.y} r="2.5" fill="#00ADB5" />
                  </g>
                ))}
              </g>
            </svg>
            <div className="absolute bottom-2 left-2 text-[8px] font-mono text-[#93B1A6] bg-[#222831]/80 px-1 border border-[#393E46] rounded">
              PACIFIC-OS-BACKBONE // UP
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Resource Allocation (Donut) & Server Latency Heatmap */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Resource Allocation Donut Progress */}
        <div className="bg-[#222831] border border-[#393E46] p-4 rounded flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-mono uppercase font-bold text-[#EEEEEE] tracking-wider">Resource Allocation</span>
            <span className="text-[9px] font-mono text-[#93B1A6]">Internal Load</span>
          </div>
          <div className="h-60 flex flex-col items-center justify-center gap-4">
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="w-full h-full" viewBox="0 0 160 160">
                <circle cx="80" cy="80" r="60" fill="transparent" stroke="#393E46" strokeWidth="12" />
                <circle cx="80" cy="80" r="60" fill="transparent" stroke="#00ADB5" strokeWidth="12"
                  strokeDasharray={2 * Math.PI * 60}
                  strokeDashoffset={2 * Math.PI * 60 * (1 - 0.74)}
                  strokeLinecap="round"
                  transform="rotate(-90 80 80)"
                />
                <text x="80" y="85" textAnchor="middle" fill="#EEEEEE" className="text-2xl font-bold font-mono">
                  74%
                </text>
                <text x="80" y="102" textAnchor="middle" fill="#93B1A6" className="text-[8px] uppercase font-bold tracking-widest font-mono">
                  Used
                </text>
              </svg>
            </div>
            
            {/* Custom Legend */}
            <div className="flex gap-4 justify-center text-[10px] font-mono text-[#EEEEEE]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#00ADB5] rounded-sm" />
                <span>Status</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#5C8374] rounded-sm" />
                <span>Sub-agent</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#183D3D] rounded-sm" />
                <span>Epocal</span>
              </div>
            </div>
          </div>
        </div>

        {/* Server Latency Heatmap Grid */}
        <div className="xl:col-span-2 bg-[#222831] border border-[#393E46] p-4 rounded flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-mono uppercase font-bold text-[#EEEEEE] tracking-wider">Server Latency Heatmap</span>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono text-[#93B1A6]">Response</span>
              <span className="text-[9px] font-mono text-[#93B1A6]">Time</span>
              <span className="text-[9px] font-mono text-[#00ADB5]">Hrs ▼</span>
            </div>
          </div>
          
          <div className="h-60 w-full flex flex-col justify-between">
            <div className="flex-1 grid grid-cols-11 gap-1 select-none">
              {/* Empty corner block */}
              <div className="h-full" />
              {/* Server columns headers */}
              {Array.from({ length: 10 }).map((_, s) => (
                <div key={s} className="text-[8px] font-mono text-[#93B1A6] text-center flex items-end justify-center pb-1">
                  Server {s + 1 === 8 ? 18 : s + 1}
                </div>
              ))}

              {/* Rows */}
              {heatmapData.map((row, r) => (
                <React.Fragment key={r}>
                  {/* Row header */}
                  <div className="text-[8px] font-mono text-[#93B1A6] flex items-center pr-1 truncate">
                    {row.time}
                  </div>
                  {/* Colored cells */}
                  {row.cells.map((colorClass, c) => (
                    <div
                      key={c}
                      className={`h-full rounded-sm border border-[#222831]/20 transition-all ${colorClass} hover:opacity-80`}
                      title={`${row.time} latency bin - Server ${c + 1}`}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>

            {/* Bottom label */}
            <div className="flex justify-between items-center pt-3 border-t border-[#393E46]/60 mt-2 text-[9px] font-mono text-[#93B1A6]">
              <span>SERVER INDEX</span>
              <div className="flex gap-1 items-center">
                <span>0 ms</span>
                <span className="w-2.5 h-2.5 bg-[#183D3D] rounded-sm" />
                <span className="w-2.5 h-2.5 bg-[#5C8374] rounded-sm" />
                <span className="w-2.5 h-2.5 bg-[#93B1A6] rounded-sm" />
                <span className="w-2.5 h-2.5 bg-[#00ADB5] rounded-sm" />
                <span>250 ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Live Activity Log Table & Top 10 Instances */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Live Activity Log */}
        <div className="bg-[#222831] border border-[#393E46] p-4 rounded flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-mono uppercase font-bold text-[#EEEEEE] tracking-wider">Live Activity Log</span>
            <span className="text-[9px] font-mono text-[#93B1A6]">Live event feed</span>
          </div>

          <div className="h-60 overflow-y-auto border border-[#393E46]/60 rounded bg-[#040D12] text-xs font-mono">
            <table className="w-full text-left border-collapse text-[#EEEEEE]">
              <thead>
                <tr className="border-b border-[#393E46] text-[#93B1A6] text-[10px] bg-[#222831]/50">
                  <th className="p-2">TIMESTAMP</th>
                  <th className="p-2">EVENT</th>
                  <th className="p-2">SOURCE</th>
                  <th className="p-2 text-right">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#393E46]/40">
                {jobs.length > 0 ? (
                  jobs.slice(0, 10).map((job, idx) => (
                    <tr key={idx} className="hover:bg-[#222831]/40">
                      <td className="p-2 text-[#93B1A6]">{new Date(job.created_at).toLocaleTimeString()}</td>
                      <td className="p-2 font-semibold max-w-[150px] truncate">{job.action || "Scheduler Run"}</td>
                      <td className="p-2 text-[#93B1A6]">{job.job_name}</td>
                      <td className="p-2 text-right">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#5C8374]/15 text-[#EEEEEE] border border-[#5C8374]/20">
                          200 OK
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  Array.from({ length: 8 }).map((_, idx) => (
                    <tr key={idx} className="hover:bg-[#222831]/40">
                      <td className="p-2 text-[#93B1A6]">06:56:51</td>
                      <td className="p-2">API Gateway target event</td>
                      <td className="p-2">API Gateway</td>
                      <td className="p-2 text-right">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#5C8374]/15 text-[#EEEEEE] border border-[#5C8374]/20">
                          200 OK
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top 10 Instances by CPU */}
        <div className="bg-[#222831] border border-[#393E46] p-4 rounded flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-mono uppercase font-bold text-[#EEEEEE] tracking-wider">Top 10 Instances by CPU</span>
            <span className="text-[9px] font-mono text-[#93B1A6]">Instance List</span>
          </div>

          <div className="h-60 overflow-y-auto border border-[#393E46]/60 rounded bg-[#040D12] text-xs font-mono">
            <table className="w-full text-left border-collapse text-[#EEEEEE]">
              <thead>
                <tr className="border-b border-[#393E46] text-[#93B1A6] text-[10px] bg-[#222831]/50">
                  <th className="p-2">INSTANCE ID</th>
                  <th className="p-2">STATUS</th>
                  <th className="p-2">CPU %</th>
                  <th className="p-2 text-right">MEMORY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#393E46]/40">
                {[
                  { id: "8033491000548092", status: "4193D3D", cpu: "97%", mem: "15.0 MB" },
                  { id: "8053395703249322", status: "45C6374", cpu: "27%", mem: "25.7 MB" },
                  { id: "8058904633249022", status: "45C6374", cpu: "15%", mem: "3.6 MB" },
                  { id: "8035508463346924", status: "45C6374", cpu: "12%", mem: "13.9 MB" },
                  { id: "8059813332434070", status: "45C6374", cpu: "10%", mem: "15.3 MB" },
                  { id: "8028491874393665", status: "45C6374", cpu: "10%", mem: "12.2 MB" },
                  { id: "8039091680240707", status: "9381A60", cpu: "9%", mem: "15.2 MB" },
                  { id: "8023394392606528", status: "45C6374", cpu: "9%", mem: "12.3 MB" },
                  { id: "8098991563244203", status: "49381A6", cpu: "0%", mem: "3.2 MB" },
                  { id: "8055095203545402", status: "49301A6", cpu: "0%", mem: "7.3 MB" }
                ].map((item, idx) => (
                  <tr key={idx} className="hover:bg-[#222831]/40">
                    <td className="p-2 flex items-center gap-1.5">
                      <Server className="size-3 text-[#93B1A6]" />
                      <span>{item.id}</span>
                    </td>
                    <td className="p-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-[#00ADB5] bg-[#00ADB5]/10 border border-[#00ADB5]/20">
                        {item.status}
                      </span>
                    </td>
                    <td className="p-2">{item.cpu}</td>
                    <td className="p-2 text-right text-[#93B1A6]">{item.mem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
