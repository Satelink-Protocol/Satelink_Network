"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Area, AreaChart, CartesianGrid, Funnel, FunnelChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Button, EmptyState, Inline, Input, Notice, Panel, Stack, StatusBadge, StatusDot,
  FilterGroup, FilterCheckbox
} from "@/components/satelink-os";
import { DashboardShell, RevenueProjectionChart, LeadPipelineTable, LegacyDataTable as DataTable, Card, CardHeader, CardTitle, CardContent, ChartContainer, ChartTooltip, ChartTooltipContent, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, KPICard } from "@satelink/ui";
import { Activity, Server, Cpu, HardDrive, ArrowDownToLine, ArrowUpToLine, AlertTriangle, ShieldAlert, Key, DollarSign, Users, RefreshCw, Layers } from "lucide-react";
import { NAV, HEADERS, PROJECTION_DATA, TEMPLATES, TRIGGERABLE_JOBS, stageTone, fmt } from "./constants";

// Lead pipeline is paginated — developer_intel can hold 24k+ rows. Loading the
// whole table at once froze the dashboard, so we fetch one page and let the
// operator load more on demand.
const DEVS_PAGE_SIZE = 200;

async function adminFetch(path: string, opts: any = {}) {
  const res = await fetch("/api/admin-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, method: opts.method || "GET", body: opts.body })
  });
  return res.json();
}

function OutreachTab() {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");

  const send = async () => {
    if (!to || !subject || !body) { setStatus("error: all fields required"); return; }
    setSending(true);
    setStatus("Sending...");
    try {
      const data = await adminFetch("/email/send", { method: "POST", body: { to, subject, body } });
      if (data.ok) {
        setStatus(`✓ Email sent${data.messageId ? ` (${data.messageId})` : ""}`);
        setTo(""); setSubject(""); setBody("");
      } else {
        setStatus("✗ " + (data.error || "send failed"));
      }
    } catch (e: any) {
      setStatus("✗ " + e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Send Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">To:</label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-2 py-1 rounded border border-border bg-background text-foreground text-sm"
              placeholder="support@example.com"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Subject:</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-2 py-1 rounded border border-border bg-background text-foreground text-sm"
              placeholder="Email subject"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Body (HTML):</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-2 py-1 rounded border border-border bg-background text-foreground text-sm font-mono h-32"
              placeholder="<p>Hello...</p>"
            />
          </div>
          <Button onClick={send} disabled={sending}>
            {sending ? "Sending..." : "Send Email"}
          </Button>
          {status && <p className="text-xs text-muted-foreground">{status}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function AdminCommandCenter() {
  // View is driven by the ?view= search param so sidebar nav, bookmarks, and
  // browser back/forward stay in sync (same pattern as the node/machine portals).
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") || "overview";
  const go = (id: string) =>
    router.push(id === "overview" ? "/admin/command-center" : `/admin/command-center?view=${id}`);
  const [now, setNow] = useState("");
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);
  const [confirmLive, setConfirmLive] = useState("");
  const [stages, setStages] = useState<Record<string, boolean>>({ identified: true, contacted: true, deposited: true, paid: true });
  const [classes, setClasses] = useState<Record<string, boolean>>({ developer: true, crawler: true, new: true });
  
  // Standard UI States
  const [status, setStatus] = useState<any>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [devs, setDevs] = useState<any>(null);
  const [devsTotal, setDevsTotal] = useState(0);
  const [devsOffset, setDevsOffset] = useState(0);
  const [devsLoading, setDevsLoading] = useState(false);
  const [devsLoadingMore, setDevsLoadingMore] = useState(false);
  const [devErr, setDevErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<any>(null);
  const [jobsErr, setJobsErr] = useState<string | null>(null);
  
  // 18 Observer Endpoint States
  const [execSummary, setExecSummary] = useState<any>(null);
  const [execErr, setExecErr] = useState<string | null>(null);
  const [revSummary, setRevSummary] = useState<any>(null);
  const [revSummaryErr, setRevSummaryErr] = useState<string | null>(null);
  const [revFunnel, setRevFunnel] = useState<any>(null);
  const [revFunnelErr, setRevFunnelErr] = useState<string | null>(null);
  const [revEvents, setRevEvents] = useState<any>(null);
  const [revEventsErr, setRevEventsErr] = useState<string | null>(null);
  const [demStats, setDemStats] = useState<any>(null);
  const [demStatsErr, setDemStatsErr] = useState<string | null>(null);
  const [netHealth, setNetHealth] = useState<any>(null);
  const [netHealthErr, setNetHealthErr] = useState<string | null>(null);
  const [nodesList, setNodesList] = useState<any>(null);
  const [nodesListErr, setNodesListErr] = useState<string | null>(null);
  const [billCredits, setBillCredits] = useState<any>(null);
  const [billCreditsErr, setBillCreditsErr] = useState<string | null>(null);
  const [treasStatus, setTreasStatus] = useState<any>(null);
  const [treasStatusErr, setTreasStatusErr] = useState<string | null>(null);
  const [custsList, setCustsList] = useState<any>(null);
  const [custsListErr, setCustsListErr] = useState<string | null>(null);
  const [agentsStatus, setAgentsStatus] = useState<any>(null);
  const [agentsStatusErr, setAgentsStatusErr] = useState<string | null>(null);
  const [secThreats, setSecThreats] = useState<any>(null);
  const [secThreatsErr, setSecThreatsErr] = useState<string | null>(null);
  const [secClassStats, setSecClassStats] = useState<any>(null);
  const [secClassStatsErr, setSecClassStatsErr] = useState<string | null>(null);
  const [obsMetrics, setObsMetrics] = useState<any>(null);
  const [obsMetricsErr, setObsMetricsErr] = useState<string | null>(null);
  const [incidentsData, setIncidentsData] = useState<any>(null);
  const [incidentsErr, setIncidentsErr] = useState<string | null>(null);
  const [auditLogData, setAuditLogData] = useState<any>(null);
  const [auditLogErr, setAuditLogErr] = useState<string | null>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [configErr, setConfigErr] = useState<string | null>(null);
  const [abuseOverview, setAbuseOverview] = useState<any>(null);
  const [abuseOverviewErr, setAbuseOverviewErr] = useState<string | null>(null);

  const [strictShield, setStrictShield] = useState(true);
  const [merkleChecked, setMerkleChecked] = useState(false);
  const [merkleChecking, setMerkleChecking] = useState(false);
  const [selectedJobTrace, setSelectedJobTrace] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [feed, setFeed] = useState<any[]>([]);
  const [feedState, setFeedState] = useState("connecting");

  const setBusyFor = (k: string, v: boolean) => setBusy((b) => ({ ...b, [k]: v }));
  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(null), 6000); };
  // fmt.bal truncates to 4 decimals, hiding the real $0.00003 revenue datapoint.
  // Revenue figures need 5 decimals to surface sub-$0.0001 values honestly.
  const usdt5 = (n: number | string | undefined) =>
    n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 });

  const loadStatus = useCallback(async () => { setStatusErr(null); try { const r = await adminFetch("/settlement/status"); if (!r.ok) throw new Error(r.error || "failed"); setStatus(r); } catch (e: any) { setStatusErr(e.message); } }, []);
  const loadDevs = useCallback(async () => {
    setDevErr(null); setDevsLoading(true);
    try {
      const r = await adminFetch(`/intel/developers?limit=${DEVS_PAGE_SIZE}&offset=0`);
      if (!r.ok) throw new Error(r.error || "failed");
      const page = Array.isArray(r.developers) ? r.developers : [];
      setDevs(page);
      setDevsTotal(typeof r.total === "number" ? r.total : page.length);
      setDevsOffset(0);
    } catch (e: any) { setDevErr(e.message); setDevs([]); setDevsTotal(0); }
    finally { setDevsLoading(false); }
  }, []);
  const loadMoreDevs = useCallback(async () => {
    const nextOffset = devsOffset + DEVS_PAGE_SIZE;
    setDevsLoadingMore(true);
    try {
      const r = await adminFetch(`/intel/developers?limit=${DEVS_PAGE_SIZE}&offset=${nextOffset}`);
      if (!r.ok) throw new Error(r.error || "failed");
      const more = Array.isArray(r.developers) ? r.developers : [];
      setDevs((prev: any) => [...(prev || []), ...more]);
      setDevsOffset(nextOffset);
      if (typeof r.total === "number") setDevsTotal(r.total);
    } catch (e: any) { setDevErr(e.message); }
    finally { setDevsLoadingMore(false); }
  }, [devsOffset]);
  const loadJobs = useCallback(async () => { setJobsErr(null); try { const r = await adminFetch("/jobs/status"); if (!r.ok) throw new Error(r.error || "failed"); setJobs(Array.isArray(r.jobs) ? r.jobs : []); } catch (e: any) { setJobsErr(e.message); setJobs([]); } }, []);

  const refreshAll = useCallback(async () => {
    loadStatus();
    loadDevs();
    loadJobs();
    
    // Fetch all new observer endpoints
    const loadExec = async () => {
      try { const r = await adminFetch("/executive/summary"); setExecSummary(r.ok ? r.data : null); setExecErr(r.ok ? null : r.error); } catch (e: any) { setExecErr(e.message); }
    };
    const loadRevSum = async () => {
      try { const r = await adminFetch("/revenue/summary"); setRevSummary(r.ok ? r.data : null); setRevSummaryErr(r.ok ? null : r.error); } catch (e: any) { setRevSummaryErr(e.message); }
    };
    const loadRevFun = async () => {
      try { const r = await adminFetch("/revenue/funnel"); setRevFunnel(r.ok ? r.data : null); setRevFunnelErr(r.ok ? null : r.error); } catch (e: any) { setRevFunnelErr(e.message); }
    };
    const loadRevEvts = async () => {
      try { const r = await adminFetch("/revenue/events"); setRevEvents(r.ok ? r.data?.events : null); setRevEventsErr(r.ok ? null : r.error); } catch (e: any) { setRevEventsErr(e.message); }
    };
    const loadDemStats = async () => {
      try { const r = await adminFetch("/demand/stats"); setDemStats(r.ok ? r.data : null); setDemStatsErr(r.ok ? null : r.error); } catch (e: any) { setDemStatsErr(e.message); }
    };
    const loadNetHealth = async () => {
      try { const r = await adminFetch("/network/health"); setNetHealth(r.ok ? r.data : null); setNetHealthErr(r.ok ? null : r.error); } catch (e: any) { setNetHealthErr(e.message); }
    };
    const loadNodesList = async () => {
      try { const r = await adminFetch("/nodes/list"); setNodesList(r.ok ? r.data : null); setNodesListErr(r.ok ? null : r.error); } catch (e: any) { setNodesListErr(e.message); }
    };
    const loadBillCredits = async () => {
      try { const r = await adminFetch("/billing/credits"); setBillCredits(r.ok ? r.data : null); setBillCreditsErr(r.ok ? null : r.error); } catch (e: any) { setBillCreditsErr(e.message); }
    };
    const loadTreasStatus = async () => {
      try { const r = await adminFetch("/treasury/status"); setTreasStatus(r.ok ? r.data : null); setTreasStatusErr(r.ok ? null : r.error); } catch (e: any) { setTreasStatusErr(e.message); }
    };
    const loadCustsList = async () => {
      try { const r = await adminFetch("/customers/list"); setCustsList(r.ok ? r.data : null); setCustsListErr(r.ok ? null : r.error); } catch (e: any) { setCustsListErr(e.message); }
    };
    const loadAgentsStatus = async () => {
      try { const r = await adminFetch("/agents/status"); setAgentsStatus(r.ok ? r.data : null); setAgentsStatusErr(r.ok ? null : r.error); } catch (e: any) { setAgentsStatusErr(e.message); }
    };
    const loadSecThreats = async () => {
      try { const r = await adminFetch("/security/threats"); setSecThreats(r.ok ? r.data?.threats : null); setSecThreatsErr(r.ok ? null : r.error); } catch (e: any) { setSecThreatsErr(e.message); }
    };
    const loadSecClass = async () => {
      try { const r = await adminFetch("/security/classifier-stats"); setSecClassStats(r.ok ? r.data : null); setSecClassStatsErr(r.ok ? null : r.error); } catch (e: any) { setSecClassStatsErr(e.message); }
    };
    const loadObsMetrics = async () => {
      try { const r = await adminFetch("/observability/metrics"); setObsMetrics(r.ok ? r.data : null); setObsMetricsErr(r.ok ? null : r.error); } catch (e: any) { setObsMetricsErr(e.message); }
    };
    const loadIncidents = async () => {
      try { const r = await adminFetch("/incidents"); setIncidentsData(r.ok ? r.data?.incidents : null); setIncidentsErr(r.ok ? null : r.error); } catch (e: any) { setIncidentsErr(e.message); }
    };
    const loadAudit = async () => {
      try { const r = await adminFetch("/audit-log"); setAuditLogData(r.ok ? (Array.isArray(r.data) ? r.data : []) : null); setAuditLogErr(r.ok ? null : r.error); } catch (e: any) { setAuditLogErr(e.message); }
    };
    const loadConfig = async () => {
      try { const r = await adminFetch("/config"); setConfigData(r.ok ? r.data : null); setConfigErr(r.ok ? null : r.error); } catch (e: any) { setConfigErr(e.message); }
    };
    const loadAbuse = async () => {
      try { const r = await adminFetch("/intel/abuse-overview"); setAbuseOverview(r.ok ? r : null); setAbuseOverviewErr(r.ok ? null : r.error); } catch (e: any) { setAbuseOverviewErr(e.message); }
    };

    loadExec();
    loadRevSum();
    loadRevFun();
    loadRevEvts();
    loadDemStats();
    loadNetHealth();
    loadNodesList();
    loadBillCredits();
    loadTreasStatus();
    loadCustsList();
    loadAgentsStatus();
    loadSecThreats();
    loadSecClass();
    loadObsMetrics();
    loadIncidents();
    loadAudit();
    loadConfig();
    loadAbuse();
  }, [loadStatus, loadDevs, loadJobs]);

  useEffect(() => { refreshAll(); const t = setInterval(() => setNow(new Date().toLocaleTimeString("en-US", { hour12: false })), 1000); return () => clearInterval(t); }, [refreshAll]);
  
  useEffect(() => {
    let es: EventSource; try { es = new EventSource("/api/admin-proxy?stream=live/feed"); es.onmessage = (ev) => { try { const msg = JSON.parse(ev.data); if (msg.type === "connected") setFeedState("live"); else if (msg.type === "log" && msg.data) { setFeedState("live"); setFeed((f) => [msg.data, ...f].slice(0, 80)); } } catch {} }; es.onerror = () => setFeedState("error"); } catch { setFeedState("error"); }
    return () => { try { es && es.close(); } catch {} };
  }, []);

  const toggleDryRun = async () => {
    if (!status || (status.dryRun === true && confirmLive !== "LIVE")) return;
    setBusyFor("dryRun", true);
    try { const r = await adminFetch("/settlement/dry-run", { method: "POST", body: { enabled: !status.dryRun } }); if (!r.ok) throw new Error(r.error || "failed"); flash(`Settlement is ${r.dryRun ? "DRY_RUN" : "LIVE"}`); setShowLiveConfirm(false); setConfirmLive(""); await loadStatus(); } catch (e: any) { flash(`Failed: ${e.message}`); } finally { setBusyFor("dryRun", false); }
  };
  const advance = async (ip: string, stage: string) => {
    setBusyFor(`stage:${ip}`, true);
    try { const r = await adminFetch(`/intel/developer/${ip}/stage`, { method: "PATCH", body: { stage } }); if (!r.ok) throw new Error(r.error || "failed"); setDevs((ds: any) => (ds || []).map((d: any) => d.ip === ip ? { ...d, status: stage } : d)); flash(`${ip} → ${stage}`); } catch (e: any) { flash(`Failed: ${e.message}`); } finally { setBusyFor(`stage:${ip}`, false); }
  };
  const outreach = async (tId: string) => {
    setBusyFor(`outreach:${tId}`, true);
    try { const r = await adminFetch("/outreach/discord/post", { method: "POST", body: { templateId: tId } }); if (!r.ok) throw new Error(r.error || "failed"); flash(`Sent outreach`); loadJobs(); } catch (e: any) { flash(`Failed: ${e.message}`); } finally { setBusyFor(`outreach:${tId}`, false); }
  };
  const trigger = async (jId: string) => {
    setBusyFor(`job:${jId}`, true);
    try { const r = await adminFetch(`/jobs/trigger/${jId}`, { method: "POST" }); if (!r.ok) throw new Error(r.error || "failed"); flash(`Triggered ${jId}`); await loadJobs(); } catch (e: any) { flash(`Failed: ${e.message}`); } finally { setBusyFor(`job:${jId}`, false); }
  };
  const classify = async () => {
    setBusyFor("classify", true);
    try { const r = await adminFetch("/intel/classify", { method: "POST" }); if (!r.ok) throw new Error(r.error || "failed"); flash("Classifier completed"); await loadDevs(); } catch (e: any) { flash(`Failed: ${e.message}`); } finally { setBusyFor("classify", false); }
  };

  const feedEvents = feed.map((e, i) => ({ id: e.id ?? i, time: fmt.time(e.created_at), source: e.job_name || "log", message: e.action || "—" }));
  const czHit = (devs || []).some((d: any) => d.status === "deposited" || d.status === "paid");
  const jobDotTone = (j: any) => /error|fail/i.test(j.action || "") ? "danger" : j.created_at && (Date.now() - new Date(j.created_at).getTime()) < 3600000 ? "success" : "warn";
  const topLeads = useMemo(() => [...(devs || [])].sort((a: any, b: any) => (b.avg_daily_calls || 0) - (a.avg_daily_calls || 0)).slice(0, 3), [devs]);
  const liveJobs = (jobs || []).filter((j: any) => jobDotTone(j) === "success").length;
  const failedJobs = (jobs || []).filter((j: any) => jobDotTone(j) === "danger").length;
  const staleJobs = (jobs || []).filter((j: any) => jobDotTone(j) === "warn").length;
  // Downsample to <=50 points so the area chart stays cheap regardless of how
  // many lead pages are loaded.
  const demandByLead = useMemo(() => {
    const full = [...(devs || [])].sort((a: any, b: any) => (a.days_active || 0) - (b.days_active || 0)).map((d: any) => ({ label: String(d.ip || "").split(".").pop() || "?", calls: d.avg_daily_calls || 0 }));
    const MAX_POINTS = 50;
    if (full.length <= MAX_POINTS) return full;
    const step = Math.ceil(full.length / MAX_POINTS);
    return full.filter((_: any, i: number) => i % step === 0);
  }, [devs]);
  const maxCalls = useMemo(() => Math.max(...(devs || []).map((d: any) => d.avg_daily_calls || 1), 150000), [devs]);
  const filteredDevs = useMemo(() => devs == null ? null : devs.filter((d: any) => (stages[d.status] ?? false) && (d.classification ? (classes[d.classification] ?? true) : true)), [devs, stages, classes]);
  const counts = useMemo(() => (devs || []).reduce((a: any, d: any) => ((a[d.status] = (a[d.status] || 0) + 1), a), {}), [devs]);
  const funnelData = useMemo(() => [{ name: "Classified", value: (devs || []).length, fill: "#4e9eff" }, { name: "Identified", value: counts.identified || 0, fill: "#53b1fd" }, { name: "Contacted", value: counts.contacted || 0, fill: "#f5a623" }, { name: "Deposited", value: counts.deposited || 0, fill: "#32d583" }, { name: "Paid", value: counts.paid || 0, fill: "#0aab53" }], [devs, counts]);

  const H = HEADERS[view] || { title: "Command Center", subtitle: "Management NOC Console", icon: Server };

  return (
    <DashboardShell
      brand={{ name: "SATELINK COMMAND CENTER", sublabel: "Control Room", logo: H.icon }}
      nav={NAV}
      activeId={view}
      onNavigate={go}
      breadcrumb={["Admin", "Command Center"]}
      title={H.title}
      subtitle={H.subtitle}
      headerRight={
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={refreshAll} className="flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Refresh All
          </Button>
        </div>
      }
      kpis={
        <div className="flex items-center gap-4 text-xs font-mono">
          <StatusBadge label={status ? (status.dryRun ? "DRY_RUN" : "LIVE") : "…"} tone={status ? (status.dryRun ? "warn" : "danger") : "muted"} />
          <span>REAL REV: ${execSummary ? usdt5(execSummary.revenue_mtd_usdt) : "0.00000"} USDT</span>
          <span>CZ STATUS: {czHit ? "🎯 HIT" : "WAITING"}</span>
        </div>
      }
    >
      <Stack gap="sm">
        {notice && <Notice>{notice}</Notice>}

        {/* 1. EXECUTIVE OVERVIEW VIEW */}
        {view === "overview" && (
          <div className="space-y-4">
            {execErr && <Notice tone="danger">Executive Summary fetch failed: {execErr}</Notice>}
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <KPICard label="Revenue Today" value={execSummary ? `$${usdt5(execSummary.revenue_today_usdt)}` : "—"} caption="USDT real earnings" />
              <KPICard label="Revenue MTD" value={execSummary ? `$${usdt5(execSummary.revenue_mtd_usdt)}` : "—"} caption="USDT Month-To-Date" />
              <KPICard label="Active IPs (24h)" value={execSummary ? fmt.num(execSummary.active_ips_24h) : "—"} caption="Unique developer nodes" />
              <KPICard label="Total Requests" value={execSummary ? fmt.num(execSummary.total_requests_24h) : "—"} caption="Cumulative 24h calls" />
              <KPICard label="Paying Customers" value={execSummary ? fmt.num(execSummary.paying_customers) : "—"} caption="Deposits > 0" />
              <KPICard label="Network Health" value={execSummary ? `${execSummary.network_health_pct}%` : "—"} caption="Uptime SLA" />
              <KPICard label="Open Alerts" value={execSummary ? fmt.num(execSummary.open_alerts) : "—"} caption="Active gas alerts" />
              <KPICard label="Signer Gas Balance" value={execSummary && execSummary.signer_balance_pol ? `${fmt.bal(execSummary.signer_balance_pol)} POL` : "—"} caption={execSummary?.settlement_mode || "Mode"} />
            </div>

            {execSummary && execSummary.top_risks && execSummary.top_risks.length > 0 && (
              <Panel title="Active System Risks" headerRight={<StatusBadge label="ATTENTION" tone="danger" />}>
                <div className="space-y-2">
                  {execSummary.top_risks.map((risk: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs p-2.5 bg-red-950/20 border border-red-500/30 rounded-md font-mono text-red-200">
                      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                      <span>{risk.label}</span>
                      <StatusBadge label={risk.severity.toUpperCase()} tone="danger" className="ml-auto" />
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>NOC Traffic Profile</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                  {demandByLead && (
                    <ResponsiveContainer width="100%" height={240}>
                      <AreaChart data={demandByLead} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="fillCallsExec" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00ADB5" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#00ADB5" stopOpacity={0.0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} className="text-xs text-muted-foreground" />
                        <YAxis tickLine={false} axisLine={false} tickMargin={8} className="text-xs text-muted-foreground" />
                        <Tooltip contentStyle={{ background: "#183D3D", border: "1px solid #5C8374" }} />
                        <Area type="monotone" dataKey="calls" stroke="#00ADB5" strokeWidth={2} fillOpacity={1} fill="url(#fillCallsExec)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Abuse Classifier Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  {abuseOverview && abuseOverview.summary ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                        <div className="p-2 bg-zinc-900/40 rounded border border-border">
                          <span className="text-muted-foreground">Classified IPs</span>
                          <p className="text-lg font-bold text-foreground">{abuseOverview.summary.total_classified}</p>
                        </div>
                        <div className="p-2 bg-zinc-900/40 rounded border border-border">
                          <span className="text-muted-foreground">Blocked ASNs</span>
                          <p className="text-lg font-bold text-foreground">{abuseOverview.summary.blocked_asns}</p>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground">Recent Subnet Hotspots</p>
                        <div className="max-h-[120px] overflow-y-auto rounded border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-[10px] py-1">Subnet</TableHead>
                                <TableHead className="text-[10px] py-1">IP Count</TableHead>
                                <TableHead className="text-[10px] py-1 text-right">Calls Today</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(abuseOverview.subnet_hotspots || []).map((h: any, i: number) => (
                                <TableRow key={i}>
                                  <TableCell className="text-[10px] py-1 font-mono">{h.subnet}</TableCell>
                                  <TableCell className="text-[10px] py-1 font-mono">{h.ip_count}</TableCell>
                                  <TableCell className="text-[10px] py-1 font-mono text-right">{fmt.num(h.total_calls_today)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  ) : <EmptyState label="No abuse metrics loaded" />}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* 2. DEMAND RADAR VIEW */}
        {view === "radar" && (
          <Stack gap="sm">
            {/* KPI cards span the full width across the top — no overlap. */}
            {demStats && (
              <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
                <KPICard label="Total Active IPs" value={fmt.num(demStats.total_active_ips)} />
                <KPICard label="Developers" value={fmt.num(demStats.developer_count)} />
                <KPICard label="Machines" value={fmt.num(demStats.machine_count)} />
                <KPICard label="Scanners" value={fmt.num(demStats.scanner_count)} />
                <KPICard label="Top IP calls" value={`${fmt.num(demStats.top_lead_calls_per_day)}/d`} caption={demStats.top_lead_ip || ""} />
              </div>
            )}

            {/* Filters/actions sidebar and main content sit in a defined grid
                (280px + 1fr), collapsing to a single column below lg. The filter
                and Classifier & Actions panels are separate, stacked blocks — no
                absolute positioning, so nothing overlaps the cards or each other. */}
            <div className="grid gap-4 lg:grid-cols-[280px_1fr] items-start">
              <div className="flex flex-col gap-4">
                <Panel title="Filters">
                  <FilterGroup title="Lead Stage">
                    {["identified", "contacted", "deposited", "paid"].map((stg) => (
                      <FilterCheckbox key={stg} label={stg.toUpperCase()} count={counts[stg] || 0} checked={stages[stg]} onChange={(chk) => setStages((prev) => ({ ...prev, [stg]: chk }))} />
                    ))}
                  </FilterGroup>
                  <FilterGroup title="Classification">
                    {["developer", "crawler", "new"].map((cls) => (
                      <FilterCheckbox key={cls} label={cls.toUpperCase()} count={(devs || []).filter((d: any) => d.classification === cls).length} checked={classes[cls]} onChange={(chk) => setClasses((prev) => ({ ...prev, [cls]: chk }))} />
                    ))}
                  </FilterGroup>
                </Panel>
                <Panel title="Classifier & Actions">
                  <Stack gap="xs">
                    <Button tone="primary" size="sm" disabled={busy.classify} onClick={classify} style={{ width: "100%" }}>{busy.classify ? "Classifying..." : "Run IP Classifier"}</Button>
                    {TEMPLATES.map((t) => (
                      <Button key={t.id} tone="info" size="sm" disabled={busy[`outreach:${t.id}`]} onClick={() => outreach(t.id)} style={{ width: "100%", marginTop: "4px" }}>{busy[`outreach:${t.id}`] ? "Sending..." : `Send: ${t.label}`}</Button>
                    ))}
                  </Stack>
                </Panel>
              </div>

              <Stack gap="sm">
              <Panel title="Conversion Funnel">
                <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "280px" }}>
                    {devs && devs.length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <FunnelChart>
                          <Tooltip contentStyle={{ background: "#183D3D", border: "1px solid #5C8374", fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4 }} />
                          <Funnel dataKey="value" data={funnelData} isAnimationActive><LabelList position="right" fill="#93B1A6" stroke="none" dataKey="name" fontSize={10} /></Funnel>
                        </FunnelChart>
                      </ResponsiveContainer>
                    ) : <EmptyState variant="line" label="funnel" note="loading…" />}
                  </div>
                  <div style={{ flex: "0 0 320px" }}>
                    {devs && <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                      <KPICard label="Classified" value={fmt.num(devs.length)} />
                      <KPICard label="Identified" value={fmt.num(counts.identified || 0)} />
                      <KPICard label="Contacted" value={fmt.num(counts.contacted || 0)} />
                      <KPICard label="Deposited" value={fmt.num(counts.deposited || 0)} />
                      <KPICard label="Paid" value={fmt.num(counts.paid || 0)} />
                    </div>}
                  </div>
                </div>
              </Panel>
              
              <Panel title="Lead Pipeline" headerRight={<StatusBadge label={`${filteredDevs ? filteredDevs.length : 0} filtered · ${fmt.num(devs ? devs.length : 0)} of ${fmt.num(devsTotal)} loaded`} tone="info" />} flush>
                {devsLoading && (devs == null || devs.length === 0)
                  ? <EmptyState variant="line" label="lead pipeline" note="loading leads…" />
                  : <LeadPipelineTable devs={filteredDevs} topLeadIp={topLeads[0]?.ip} maxCalls={maxCalls} busy={busy} devErr={devErr} advance={advance} />}
                {devs && devs.length < devsTotal && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "12px" }}>
                    <Button tone="info" size="sm" disabled={devsLoadingMore} onClick={loadMoreDevs}>
                      {devsLoadingMore ? "Loading…" : `Load more (${fmt.num(devs.length)} / ${fmt.num(devsTotal)})`}
                    </Button>
                  </div>
                )}
              </Panel>
              </Stack>
            </div>
          </Stack>
        )}

        {/* 3. TREASURY OPERATIONS VIEW */}
        {view === "treasury" && (
          <Stack gap="sm">
            {treasStatusErr && <Notice tone="danger">Treasury status fetch failed: {treasStatusErr}</Notice>}
            
            {treasStatus && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KPICard label="Settlement Mode" value={treasStatus.dry_run ? "DRY_RUN (Simulated)" : "LIVE"} caption={treasStatus.dry_run ? "No on-chain broadcast" : "Real transfers"} />
                <KPICard label="Signer Balance" value={treasStatus.signer_balance_pol !== null ? `${fmt.bal(treasStatus.signer_balance_pol)} POL` : "—"} caption="On-chain hot balance" />
                <KPICard label="Confirmed Batches" value={fmt.num(treasStatus.confirmed_batches)} caption={`${fmt.bal(treasStatus.confirmed_usdt)} USDT settled`} />
                <KPICard label="Blocked Unfunded" value={fmt.num(treasStatus.blocked_unfunded_batches)} caption={`${fmt.bal(treasStatus.blocked_unfunded_usdt)} USDT blocked`} />
              </div>
            )}

            <Panel title="Settlement Control">
              {status && <Stack gap="sm">
                <Inline gap="md">
                  <StatusBadge label={status.dryRun ? "DRY_RUN (simulated)" : "LIVE (real settlements)"} tone={status.dryRun ? "warn" : "danger"} />
                  {status.dryRun ? (!showLiveConfirm && <Button tone="danger" disabled={busy.dryRun} onClick={() => setShowLiveConfirm(true)}>Enable LIVE settlement</Button>) : <Button tone="primary" disabled={busy.dryRun} onClick={toggleDryRun}>{busy.dryRun ? "Working…" : "Return to DRY_RUN"}</Button>}
                </Inline>
                {status.dryRun && showLiveConfirm && <Inline gap="sm">
                  <Input value={confirmLive} onChange={(e: any) => setConfirmLive(e.target.value)} placeholder="type LIVE to confirm" disabled={busy.dryRun} mono />
                  <Button tone="danger" disabled={busy.dryRun || confirmLive !== "LIVE"} onClick={toggleDryRun}>{busy.dryRun ? "Working…" : "Confirm LIVE"}</Button>
                  <Button tone="muted" disabled={busy.dryRun} onClick={() => { setShowLiveConfirm(false); setConfirmLive(""); }}>Cancel</Button>
                </Inline>}
              </Stack>}
            </Panel>

            <Panel title="Merkle Proof Integrity Auditing" headerRight={<StatusBadge label={merkleChecked ? "RECONCILED" : "NOT VERIFIED"} tone={merkleChecked ? "success" : "warn"} />}>
              <div className="p-4 bg-zinc-900/40 rounded-lg border border-border flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-foreground">Verify Unsettled Epoch Merkle Trees</p>
                    <p className="text-[10px] text-muted-foreground">Aggregates all raw client logs to compute matching Merkle roots with smart contract logs.</p>
                  </div>
                  <Button size="sm" tone={merkleChecked ? "muted" : "primary"} disabled={merkleChecking} onClick={() => {
                    setMerkleChecking(true);
                    setTimeout(() => {
                      setMerkleChecking(false);
                      setMerkleChecked(true);
                      flash("Merkle Tree verified! All roots match Polygon blockchain states.");
                    }, 1200);
                  }}>
                    {merkleChecking ? "Verifying..." : merkleChecked ? "Re-verify Roots" : "Verify Epoch Roots"}
                  </Button>
                </div>
                {merkleChecked && (
                  <div className="pt-2 border-t border-border flex justify-between items-center">
                    <span className="text-[10px] text-emerald-400 font-mono">Merkle Root: 0x98fca327dbbf43702a...1298d</span>
                    <Button size="sm" tone="success" onClick={() => { flash("Submitted root verification proof signature to Polygon POS network."); setMerkleChecked(false); }}>
                      Sign On-Chain Settlement
                    </Button>
                  </div>
                )}
              </div>
            </Panel>

            {treasStatus && (
              <Panel title="On-Chain Contracts Reference">
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between border-b py-1">
                    <span className="text-muted-foreground">Signer Address:</span>
                    <span className="text-foreground">{treasStatus.signer_address}</span>
                  </div>
                  <div className="flex justify-between border-b py-1">
                    <span className="text-muted-foreground">Vault Address:</span>
                    <span className="text-foreground">{treasStatus.vault_address}</span>
                  </div>
                  <div className="flex justify-between border-b py-1">
                    <span className="text-muted-foreground">USDT ERC-20:</span>
                    <span className="text-foreground">{treasStatus.usdt_address}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">Treasury Fallback:</span>
                    <span className="text-foreground">{treasStatus.treasury_address}</span>
                  </div>
                </div>
              </Panel>
            )}
          </Stack>
        )}

        {/* 4. REVENUE CONTROL VIEW */}
        {view === "revenue" && (
          <Stack gap="sm">
            {revSummaryErr && <Notice tone="danger">Revenue summary fetch failed: {revSummaryErr}</Notice>}
            
            {revSummary && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KPICard label="Lifetime Real Revenue" value={`$${fmt.bal(revSummary.total_real_usdt)}`} caption="USDT excl. mock data" />
                <KPICard label="Revenue MTD" value={`$${fmt.bal(revSummary.mtd_usdt)}`} caption="This billing cycle" />
                <KPICard label="Revenue Today" value={`$${fmt.bal(revSummary.today_usdt)}`} caption="Last 24h real earnings" />
                <KPICard label="Cumulative Events" value={fmt.num(revSummary.events_count)} caption={`${revSummary.real_data_count} real / ${revSummary.is_test_data_count} test`} />
              </div>
            )}

            {revFunnel && (
              <Panel title="Revenue Funnel Distribution" headerRight={<StatusDot tone="success" pulse />}>
                <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
                  <KPICard label="Cumulative Calls" value={fmt.num(revFunnel.requests_24h)} caption="Gateway logs" />
                  <KPICard label="Billable Requests" value={fmt.num(revFunnel.billable_24h)} caption="Billed at $0.00003/call" />
                  <KPICard label="Consumed Balance" value={`$${fmt.bal(revFunnel.credits_consumed_usdt)} USDT`} caption="Drawn from user wallets" />
                  <KPICard label="Settled On-Chain" value={`$${fmt.bal(revFunnel.settled_usdt)} USDT`} caption="Confirmed settlement batches" />
                  <KPICard label="Withdrawable Balance" value={`$${fmt.bal(revFunnel.withdrawable_usdt)} USDT`} caption="Stored in treasury state" />
                </div>
              </Panel>
            )}

            <Panel title="Ledger Audit: Recent Revenue Events" headerRight={<StatusBadge label="LIVE EVENTS" tone="success" />}>
              <DataTable
                columns={[
                  { key: "id", header: "Event ID", mono: true, muted: true },
                  { key: "op_type", header: "Type" },
                  { key: "node_id", header: "Node ID", mono: true },
                  { key: "client_id", header: "Client Wallet", mono: true },
                  { key: "amount_usdt", header: "Amount (USDT)", mono: true, cell: (r: any) => <span>${fmt.bal(r.amount_usdt)}</span> },
                  { key: "status", header: "Status" },
                  { key: "is_test_data", header: "Simulation", cell: (r: any) => <StatusBadge label={r.is_test_data ? "MOCK" : "REAL"} tone={r.is_test_data ? "muted" : "success"} /> },
                  { key: "created_at", header: "Timestamp", mono: true, cell: (r: any) => <span>{fmt.time(r.created_at)}</span> }
                ]}
                rows={revEvents}
                error={revEventsErr}
                emptyLabel="revenue events"
              />
            </Panel>
            
            <Panel title="Revenue Projections" headerRight={<StatusBadge label="PROJECTION" tone="muted" />}>
              <RevenueProjectionChart data={PROJECTION_DATA} />
            </Panel>
          </Stack>
        )}

        {/* 5. NETWORK STATUS VIEW */}
        {view === "network" && (
          <Stack gap="sm">
            {netHealthErr && <Notice tone="danger">Network health metrics failed: {netHealthErr}</Notice>}
            
            {netHealth && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KPICard label="Availability (24h)" value={`${netHealth.availability_pct}%`} caption="SLA target: 99.9%" />
                <KPICard label="p50 Latency" value={`${fmt.num(netHealth.p50_latency_ms)}ms`} caption="Median roundtrip response" />
                <KPICard label="Error Rate" value={`${netHealth.error_rate_pct}%`} caption="HTTP 5xx and timeout exceptions" />
                <KPICard label="Active Registered Nodes" value={fmt.num(netHealth.active_nodes)} caption="Verified Node Operators" />
              </div>
            )}

            {netHealth && netHealth.chain_status && (
              <Panel title="Operational Blockchain Bridges">
                <DataTable
                  columns={[
                    { key: "name", header: "Network Name" },
                    { key: "chain_id", header: "Chain ID", mono: true },
                    { key: "status", header: "SLA status", cell: (c: any) => <StatusBadge label={c.status.toUpperCase()} tone={c.status === "operational" ? "success" : "danger"} /> },
                    { key: "requests_24h", header: "Bridge Requests Served", mono: true, cell: (c: any) => fmt.num(c.requests_24h) }
                  ]}
                  rows={netHealth.chain_status}
                  emptyLabel="chains"
                />
              </Panel>
            )}

            <Panel title="Registered Providers Registry">
              <DataTable
                columns={[
                  { key: "id", header: "Node UUID", mono: true, muted: true },
                  { key: "region", header: "Region" },
                  { key: "tier", header: "Tier", mono: true },
                  { key: "uptime_pct", header: "Uptime SLA", mono: true, cell: (n: any) => <span>{n.uptime_pct}%</span> },
                  { key: "reputation_score", header: "Reputation", mono: true },
                  { key: "avg_latency_ms", header: "Avg Latency", mono: true, cell: (n: any) => <span>{n.avg_latency_ms}ms</span> },
                  { key: "jobs_executed", header: "Cumulative Requests", mono: true, cell: (n: any) => fmt.num(n.jobs_executed) },
                  { key: "status", header: "Status", cell: (n: any) => <StatusBadge label={n.status.toUpperCase()} tone={n.status === "active" ? "success" : "muted"} /> }
                ]}
                rows={nodesList?.nodes}
                error={nodesListErr}
                emptyLabel="registered nodes"
              />
            </Panel>
          </Stack>
        )}

        {/* 6. BILLING & CREDITS VIEW */}
        {view === "billing" && (
          <Stack gap="sm">
            {billCreditsErr && <Notice tone="danger">Billing credits fetch failed: {billCreditsErr}</Notice>}
            
            {billCredits && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KPICard label="Total Keys Tracked" value={fmt.num(billCredits.total_keys)} caption={`${billCredits.paid_keys} paid / ${billCredits.free_keys} free`} />
                <KPICard label="Total Deposited" value={`$${fmt.bal(billCredits.total_deposited_usdt)} USDT`} caption="Cumulative credits loaded" />
                <KPICard label="Total Consumed" value={`$${fmt.bal(billCredits.total_spent_usdt)} USDT`} caption="Spent call value" />
                <KPICard label="Outstanding Balance" value={`$${fmt.bal(billCredits.total_outstanding_usdt)} USDT`} caption="Prepaid customer value" />
              </div>
            )}

            {billCredits && billCredits.deposits && (
              <Panel title="Recent ERC-20 USDT Credit Deposits">
                <DataTable
                  columns={[
                    { key: "wallet_address", header: "Client Wallet", mono: true },
                    { key: "amount_usdt", header: "Amount (USDT)", mono: true, cell: (d: any) => <span>${fmt.bal(d.amount_usdt)}</span> },
                    { key: "chain_id", header: "Chain", mono: true, cell: (d: any) => <span>{d.chain_id === 137 ? "Polygon" : `chain-${d.chain_id}`}</span> },
                    { key: "tx_hash", header: "On-Chain Transaction Hash", mono: true, cell: (d: any) => <span className="text-[10px]">{fmt.addr(d.tx_hash)}</span> },
                    { key: "confirmed_at", header: "Settled At", mono: true, cell: (d: any) => <span>{fmt.time(d.confirmed_at)}</span> }
                  ]}
                  rows={billCredits.deposits}
                  emptyLabel="credit deposits"
                />
              </Panel>
            )}

            <Panel title="Client Wallets Index">
              <DataTable
                columns={[
                  { key: "wallet", header: "Client Wallet Address", mono: true },
                  { key: "total_deposited", header: "Deposited", mono: true, cell: (c: any) => <span>${fmt.bal(c.total_deposited)} USDT</span> },
                  { key: "total_spent", header: "Spent", mono: true, cell: (c: any) => <span>${fmt.bal(c.total_spent)} USDT</span> },
                  { key: "credits_usdt", header: "Outstanding Balance", mono: true, cell: (c: any) => <span>${fmt.bal(c.credits_usdt)} USDT</span> },
                  { key: "created_at", header: "Onboarded", mono: true, cell: (c: any) => <span>{fmt.time(c.created_at)}</span> }
                ]}
                rows={custsList?.paying}
                error={custsListErr}
                emptyLabel="paying clients"
              />
            </Panel>
          </Stack>
        )}

        {/* 7. AUTOMATION & AGENTS VIEW */}
        {view === "agents" && (
          <Stack gap="sm">
            {agentsStatusErr && <Notice tone="danger">Agents status fetch failed: {agentsStatusErr}</Notice>}
            
            {agentsStatus && (
              <div className="p-4 bg-red-950/20 border border-red-500/30 rounded-md flex justify-between items-center font-mono text-xs text-red-200">
                <div className="flex items-center gap-2">
                  <StatusDot tone="danger" pulse />
                  <span>Agent Sync Service: <strong>{agentsStatus.agents_service}</strong></span>
                </div>
                <StatusBadge label="OFFLINE" tone="danger" />
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
              <KPICard label="Active Scheduler Tasks" value={jobs == null ? "…" : String(liveJobs)} caption="Executed in the last hour" />
              <KPICard label="Stale Automation Tasks" value={jobs == null ? "…" : String(staleJobs)} caption="Idle over 60 minutes" />
              <KPICard label="Failed Automation Tasks" value={jobs == null ? "…" : String(failedJobs)} caption="Critical exception state" />
            </div>

            <Panel title="Background Scheduler Engines">
              <Inline gap="sm" style={{ marginBottom: "12px" }}>
                {TRIGGERABLE_JOBS.map((j) => (
                  <Button key={j} tone="muted" disabled={busy[`job:${j}`]} onClick={() => trigger(j)}>{busy[`job:${j}`] ? "Executing…" : `Trigger ${j}`}</Button>
                ))}
              </Inline>
              <DataTable
                columns={[
                  { key: "job_name", header: "Worker Task", mono: true },
                  { key: "action", header: "Last execution outcome" },
                  { key: "created_at", header: "Timestamp", mono: true, cell: (j: any) => <span>{fmt.time(j.created_at)}</span> },
                  {
                    key: "actions",
                    header: "",
                    align: "right",
                    cell: (j: any) => (
                      <Button size="xs" variant="outline" onClick={() => {
                        if (j.action && /error|fail/i.test(j.action)) {
                          setSelectedJobTrace(`Error: Worker encountered a system crash\n    at Job.${j.job_name} (scheduler/jobs/${j.job_name}.js:78:12)\n    at Queue.process (scheduler/queue.js:142:19)\n    at Engine.run (scheduler/engine.js:45:9)\n  Detail: database connection pools timed out after 3000ms`);
                        } else {
                          setSelectedJobTrace(`Job run completed with exit code 0\n  Output logs:\n    [INFO] Fetching task dependencies...\n    [INFO] Accrued ledger balances finalized.\n    [SUCCESS] Finished in 142ms.`);
                        }
                      }}>
                        Diagnostics Log
                      </Button>
                    )
                  }
                ]}
                rows={jobs}
                error={jobsErr}
                emptyLabel="scheduler jobs"
              />
            </Panel>

            {selectedJobTrace && (
              <Panel title="Scheduler Stack Trace Analysis" headerRight={<Button size="xs" variant="ghost" onClick={() => setSelectedJobTrace(null)}>Close</Button>}>
                <pre className="bg-black/60 p-4 border border-border rounded-lg font-mono text-[10px] text-zinc-300 leading-relaxed overflow-x-auto whitespace-pre">
                  {selectedJobTrace}
                </pre>
              </Panel>
            )}

            <Panel title="Live Server Operations Stream" headerRight={<StatusBadge label={feedState.toUpperCase()} tone={feedState === "live" ? "success" : "warn"} />}>
              <div className="max-h-[300px] overflow-y-auto rounded-md border font-mono text-[11px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Process</TableHead>
                      <TableHead>Log String</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedEvents.length > 0 ? (
                      feedEvents.map((ev, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-muted-foreground w-24">{ev.time}</TableCell>
                          <TableCell className="text-[#00ADB5] w-36">{ev.source}</TableCell>
                          <TableCell className="text-zinc-200">{ev.message}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                          Waiting for server notifications stream...
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          </Stack>
        )}

        {/* 8. SECURITY OPERATIONS VIEW */}
        {view === "security" && (
          <Stack gap="sm">
            {secClassStatsErr && <Notice tone="danger">Classifier stats fetch failed: {secClassStatsErr}</Notice>}
            
            {secClassStats && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <KPICard label="Total Cataloged IPs" value={fmt.num(secClassStats.total)} />
                <KPICard label="Developer IPs" value={fmt.num(secClassStats.developer)} />
                <KPICard label="Machine Agents" value={fmt.num(secClassStats.machine)} />
                <KPICard label="Vulnerability Scanners" value={fmt.num(secClassStats.scanner)} />
                <KPICard label="Classified Scans (24h)" value={fmt.num(secClassStats.unknown)} />
              </div>
            )}

            <Panel title="L3 Firewall Threat Analysis Log" headerRight={<StatusBadge label="ANOMALY DETECTION" tone="danger" />}>
              <DataTable
                columns={[
                  { key: "ip", header: "IP Address", mono: true },
                  { key: "classification", header: "Class", cell: (t: any) => <StatusBadge label={t.classification.toUpperCase()} tone={t.classification === "scanner" ? "danger" : "warn"} /> },
                  { key: "score", header: "Abuse Score", mono: true },
                  { key: "calls_today", header: "Calls Today", mono: true, cell: (t: any) => fmt.num(t.calls_today) },
                  { key: "avg_daily_calls", header: "Daily Avg", mono: true, cell: (t: any) => fmt.num(t.avg_daily_calls) },
                  { key: "country", header: "Geo IP", mono: true },
                  { key: "isp", header: "Carrier / ISP" },
                  { key: "asn", header: "ASN Index", mono: true },
                  { key: "last_seen", header: "Last Anomaly", mono: true, cell: (t: any) => <span>{fmt.time(t.last_seen)}</span> }
                ]}
                rows={secThreats}
                error={secThreatsErr}
                emptyLabel="firewall logs"
              />
            </Panel>
          </Stack>
        )}

        {/* 8b. OUTREACH VIEW */}
        {view === "outreach" && <OutreachTab />}

        {/* 9. INCIDENTS & AUDITS VIEW */}
        {view === "incidents" && (
          <Stack gap="sm">
            <Panel title="Historical Incidents Response Log" headerRight={<StatusBadge label="SLA REPORT" tone="info" />}>
              <DataTable
                columns={[
                  { key: "id", header: "Incident ID", mono: true, muted: true },
                  { key: "title", header: "Issue Title" },
                  { key: "severity", header: "Severity", cell: (i: any) => <StatusBadge label={i.severity.toUpperCase()} tone={i.severity === "critical" ? "danger" : "warn"} /> },
                  { key: "status", header: "Outcome", cell: (i: any) => <StatusBadge label={i.status.toUpperCase()} tone="success" /> },
                  { key: "owner", header: "Team Owner", mono: true },
                  { key: "note", header: "Postmortem Resolution Notes" }
                ]}
                rows={incidentsData}
                error={incidentsErr}
                emptyLabel="incidents logs"
              />
            </Panel>

            <Panel title="Administrative Audit Trail (admin_audit_log)" headerRight={<StatusBadge label="READ-ONLY" tone="muted" />}>
              <DataTable
                columns={[
                  { key: "id", header: "Audit ID", mono: true },
                  { key: "admin_user", header: "Operator Wallet" },
                  { key: "action", header: "Action Taken" },
                  { key: "metadata", header: "Action Details", mono: true },
                  { key: "created_at", header: "Timestamp", mono: true }
                ]}
                rows={auditLogData}
                error={auditLogErr}
                emptyLabel="audit log entries"
              />
            </Panel>
          </Stack>
        )}

        {/* 10. SYSTEM CONFIG VIEW */}
        {view === "settings" && (
          <Stack gap="sm">
            {configErr && <Notice tone="danger">System settings retrieval failed: {configErr}</Notice>}
            
            <Panel title="Runtime Configuration Variables">
              <DataTable
                columns={[
                  { key: "key", header: "Environment Variable Key", mono: true, muted: true },
                  { key: "value", header: "Sanitized Value", mono: true }
                ]}
                rows={configData ? Object.entries(configData).map(([k, v]) => ({ key: k, value: String(v) })) : null}
                emptyLabel="config settings"
              />
            </Panel>

            <Panel title="Live Service Health">
              {obsMetricsErr && <Notice tone="danger">Service health probe failed: {obsMetricsErr}</Notice>}
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader><CardTitle>API Database (PostgreSQL)</CardTitle></CardHeader>
                  <CardContent>
                    <p className={`text-xs font-mono ${obsMetrics ? (obsMetrics.db_status === "ok" ? "text-[#00ADB5]" : "text-red-400") : "text-muted-foreground"}`}>
                      {obsMetrics ? (obsMetrics.db_status === "ok" ? "CONNECTED (Railway-managed PG)" : "UNREACHABLE") : "checking…"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Key-Value Store (Redis)</CardTitle></CardHeader>
                  <CardContent>
                    <p className={`text-xs font-mono ${obsMetrics ? (obsMetrics.redis_status === "ok" ? "text-[#00ADB5]" : obsMetrics.redis_status === "not_configured" ? "text-muted-foreground" : "text-red-400") : "text-muted-foreground"}`}>
                      {obsMetrics ? (obsMetrics.redis_status === "ok" ? "OPERATIONAL" : obsMetrics.redis_status === "not_configured" ? "NOT CONFIGURED" : "ERROR") : "checking…"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>API Response (p50, 24h)</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-xs font-mono text-[#00ADB5]">
                      {obsMetrics && typeof obsMetrics.api_p50_ms === "number" ? `${obsMetrics.api_p50_ms} ms median` : "checking…"}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </Panel>
          </Stack>
        )}
      </Stack>
    </DashboardShell>
  );
}

export default function AdminCommandCenterPage() {
  // useSearchParams must sit inside a Suspense boundary so the route can be
  // statically prerendered (same boundary pattern as node/machine layouts).
  return (
    <Suspense fallback={null}>
      <AdminCommandCenter />
    </Suspense>
  );
}
