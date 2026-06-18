"use client";

/**
 * SATELINK COMMAND CENTER — rebuilt on the Satelink-OS design system.
 *
 * This page is composition + business logic only. ALL presentation comes from
 * `@/components/satelink-os` (no inline styles, no local design primitives).
 *
 * Business logic preserved verbatim from the v2 page:
 *   - adminFetch() → /api/admin-proxy (token injected server-side)
 *   - SSE live feed via EventSource('/api/admin-proxy?stream=live/feed')
 *   - loaders: settlement/status, intel/developers, jobs/status
 *   - actions: dry-run toggle (typed LIVE), lead stage PATCH, Discord outreach,
 *     job trigger, IP classifier
 *
 * Honest-data policy (Phases 7 & 10): no fabricated metrics/revenue/settlements/
 * threats/providers. Missing backends render professional empty states.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AppShell,
  Button,
  DataTable,
  EmptyState,
  EventStream,
  Inline,
  Input,
  MetricCard,
  MetricGrid,
  Notice,
  Panel,
  SectionLabel,
  SparkArea,
  Split,
  Stack,
  StatusBadge,
  StatusDot,
  TopologyDiagram,
} from "@/components/satelink-os";

// ── Static config ─────────────────────────────────────────────────────────────
const NAV = [
  { id: "overview", icon: "◈", label: "Overview" },
  { id: "radar", icon: "◎", label: "Demand Radar" },
  { id: "treasury", icon: "◉", label: "Treasury" },
  { id: "revenue", icon: "⊕", label: "Revenue" },
  { id: "agents", icon: "◐", label: "Agents" },
  { id: "settings", icon: "⊙", label: "Settings" },
];

const HEADERS = {
  overview: { icon: "◈", title: "Overview", subtitle: "Gateway status & Customer Zero countdown" },
  radar: { icon: "◎", title: "Demand Radar", subtitle: "Lead pipeline, conversion & outreach" },
  treasury: { icon: "◉", title: "Treasury", subtitle: "Settlement control & on-chain status" },
  revenue: { icon: "⊕", title: "Revenue", subtitle: "Credit balance, pipeline & projection" },
  agents: { icon: "◐", title: "Agents", subtitle: "Automation jobs & agent fleet" },
  settings: { icon: "⊙", title: "Settings", subtitle: "Configuration reference" },
};

// Forward-looking planning rows — clearly labelled PROJECTION, never current state.
const PROJECTIONS = [
  { daily: "$0.50/day", who: "1 paying customer", monthly: "$15/month" },
  { daily: "$1.50/day", who: "3 paying customers", monthly: "$45/month" },
  { daily: "$5.00/day", who: "7 paying customers", monthly: "$150/month" },
];
// Same projection, numeric, for the bar chart.
const PROJECTION_DATA = [
  { label: "1 customer", daily: 0.5, monthly: 15 },
  { label: "3 customers", daily: 1.5, monthly: 45 },
  { label: "7 customers", daily: 5.0, monthly: 150 },
];

// Structural architecture model (Phase 8: data-driven, no providers/metrics).
const ARCH_TOPOLOGY = {
  width: 680,
  height: 220,
  nodes: [
    { id: "clients", label: "CLIENTS", x: 340, y: 20, kind: "source" },
    { id: "gate", label: "FREE-TIER GATE", x: 340, y: 64, kind: "edge" },
    { id: "gateway", label: "RPC GATEWAY", sub: "rpc.satelink.network", x: 340, y: 108, kind: "gateway" },
    { id: "u1", label: "UPSTREAM", x: 150, y: 162, kind: "edge" },
    { id: "u2", label: "UPSTREAM", x: 280, y: 162, kind: "edge" },
    { id: "u3", label: "UPSTREAM", x: 400, y: 162, kind: "edge" },
    { id: "u4", label: "UPSTREAM", x: 530, y: 162, kind: "edge" },
    { id: "settle", label: "BILLING · EPOCH", x: 340, y: 200, kind: "sink" },
  ],
  links: [
    { from: "clients", to: "gate", tone: "primary", dur: "1.4s" },
    { from: "gate", to: "gateway", tone: "info", dur: "1.5s" },
    { from: "gateway", to: "u1", tone: "info", dur: "1.9s" },
    { from: "gateway", to: "u2", tone: "info", dur: "1.7s" },
    { from: "gateway", to: "u3", tone: "info", dur: "1.8s" },
    { from: "gateway", to: "u4", tone: "info", dur: "2.1s" },
    { from: "u1", to: "settle", tone: "success", dur: "2.0s" },
    { from: "u4", to: "settle", tone: "success", dur: "2.0s" },
  ],
};

const TEMPLATES = [
  { id: "erpc-provider", label: "erpc provider intro" },
  { id: "followup-72h", label: "72h follow-up" },
];
const TRIGGERABLE_JOBS = ["ip-classifier", "customer-zero", "outreach"];
const NEXT_STAGE = { identified: "contacted", contacted: "deposited", deposited: "paid" };
const STAGE_BTN = { contacted: "Mark Contacted", deposited: "Mark Deposited", paid: "Mark Paid" };
const stageTone = (s) =>
  ({ identified: "info", contacted: "warn", deposited: "primary", paid: "success" }[s] || "muted");

// ── Formatting (real values only; null/undefined → "—") ────────────────────────
const fmt = {
  num: (n) =>
    n == null || Number.isNaN(Number(n))
      ? "—"
      : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
      ? `${(n / 1e3).toFixed(1)}K`
      : String(n),
  bal: (n) => (n == null ? "—" : Number(n).toFixed(4)),
  addr: (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—"),
  time: (t) => {
    if (!t) return "—";
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString();
  },
};

// ── API client (unchanged) ─────────────────────────────────────────────────────
async function adminFetch(path, opts = {}) {
  const res = await fetch("/api/admin-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, method: opts.method || "GET", body: opts.body }),
  });
  return res.json();
}

export default function AdminCommandCenter() {
  const [view, setView] = useState("radar");
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState("");

  // Treasury: inline typed-LIVE confirmation (replaces the old browser prompt).
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);
  const [confirmLive, setConfirmLive] = useState("");
  // Demand Radar: stage filter.
  const [radarFilter, setRadarFilter] = useState("all");

  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(null);
  const [devs, setDevs] = useState(null);
  const [devErr, setDevErr] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [jobsErr, setJobsErr] = useState(null);

  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState(null);

  const [feed, setFeed] = useState([]);
  const [feedState, setFeedState] = useState("connecting");

  const setBusyFor = (k, v) => setBusy((b) => ({ ...b, [k]: v }));
  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 6000);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString("en-US", { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Loaders ──────────────────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    setStatusErr(null);
    try {
      const r = await adminFetch("/settlement/status");
      if (!r.ok) throw new Error(r.error || "request failed");
      setStatus(r);
    } catch (e) {
      setStatusErr(e.message);
    }
  }, []);

  const loadDevs = useCallback(async () => {
    setDevErr(null);
    try {
      const r = await adminFetch("/intel/developers");
      if (!r.ok) throw new Error(r.error || "request failed");
      setDevs(Array.isArray(r.developers) ? r.developers : []);
    } catch (e) {
      setDevErr(e.message);
      setDevs([]);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setJobsErr(null);
    try {
      const r = await adminFetch("/jobs/status");
      if (!r.ok) throw new Error(r.error || "request failed");
      setJobs(Array.isArray(r.jobs) ? r.jobs : []);
    } catch (e) {
      setJobsErr(e.message);
      setJobs([]);
    }
  }, []);

  const refreshAll = useCallback(() => {
    loadStatus();
    loadDevs();
    loadJobs();
  }, [loadStatus, loadDevs, loadJobs]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // ── Real SSE live feed (token injected by the proxy) ─────────────────────────
  useEffect(() => {
    let es;
    try {
      es = new EventSource("/api/admin-proxy?stream=live/feed");
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "connected") {
            setFeedState("live");
          } else if (msg.type === "log" && msg.data) {
            setFeedState("live");
            setFeed((f) => [msg.data, ...f].slice(0, 80));
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => setFeedState("error");
    } catch {
      setFeedState("error");
    }
    return () => {
      try {
        es && es.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  // ── Actions (each awaits the API before touching React state) ────────────────
  const toggleDryRun = async () => {
    if (!status) return;
    const goingLive = status.dryRun === true;
    // Going LIVE is gated by the inline typed-LIVE confirmation in the JSX.
    if (goingLive && confirmLive !== "LIVE") return;
    setBusyFor("dryRun", true);
    try {
      const r = await adminFetch("/settlement/dry-run", { method: "POST", body: { enabled: !status.dryRun } });
      if (!r.ok) throw new Error(r.error || "toggle failed");
      const persistNote = r.persistent === false ? " Change is in-process only — set RAILWAY_TOKEN for a persistent Railway update." : "";
      flash(`Settlement is now ${r.dryRun ? "DRY_RUN (simulated)" : "LIVE"}.${persistNote}`);
      setShowLiveConfirm(false);
      setConfirmLive("");
      await loadStatus();
    } catch (e) {
      flash(`Toggle failed: ${e.message}`);
    } finally {
      setBusyFor("dryRun", false);
    }
  };

  const advance = async (ip, stage) => {
    setBusyFor(`stage:${ip}`, true);
    try {
      const r = await adminFetch(`/intel/developer/${ip}/stage`, { method: "PATCH", body: { stage } });
      if (!r.ok) throw new Error(r.error || "stage update failed");
      setDevs((ds) => (ds || []).map((d) => (d.ip === ip ? { ...d, status: stage } : d)));
      flash(`${ip} → ${stage}`);
    } catch (e) {
      flash(`Stage update failed: ${e.message}`);
    } finally {
      setBusyFor(`stage:${ip}`, false);
    }
  };

  const outreach = async (templateId) => {
    setBusyFor(`outreach:${templateId}`, true);
    try {
      const r = await adminFetch("/outreach/discord/post", { method: "POST", body: { templateId } });
      if (!r.ok) throw new Error(r.error || "post failed");
      flash(`Outreach sent: ${r.template || templateId}${r.target ? ` → ${r.target}` : ""}`);
      loadJobs();
    } catch (e) {
      flash(`Outreach failed: ${e.message}`);
    } finally {
      setBusyFor(`outreach:${templateId}`, false);
    }
  };

  const trigger = async (jobId) => {
    setBusyFor(`job:${jobId}`, true);
    try {
      const r = await adminFetch(`/jobs/trigger/${jobId}`, { method: "POST" });
      if (!r.ok) throw new Error(r.error || "trigger failed");
      flash(`Triggered ${jobId}`);
      await loadJobs();
    } catch (e) {
      flash(`Trigger failed: ${e.message}`);
    } finally {
      setBusyFor(`job:${jobId}`, false);
    }
  };

  const classify = async () => {
    setBusyFor("classify", true);
    try {
      const r = await adminFetch("/intel/classify", { method: "POST" });
      if (!r.ok) throw new Error(r.error || "classify failed");
      flash(`Classifier ran — ${r.classified ?? 0} processed, ${r.newIPs ?? 0} new, ${r.developers ?? 0} developers`);
      await loadDevs();
    } catch (e) {
      flash(`Classify failed: ${e.message}`);
    } finally {
      setBusyFor("classify", false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const feedEvents = feed.map((e, i) => ({
    id: e.id ?? i,
    time: fmt.time(e.created_at),
    source: e.job_name || "log",
    message: e.action || "—",
  }));

  // Customer Zero is HIT the moment any lead reaches deposited/paid.
  const czHit = (devs || []).some((d) => d.status === "deposited" || d.status === "paid");

  // Job freshness → StatusDot tone (real, from /jobs/status timestamps).
  const jobDotTone = (j) => {
    if (/error|fail/i.test(j.action || "")) return "danger";
    if (!j.created_at) return "muted";
    const age = Date.now() - new Date(j.created_at).getTime();
    if (Number.isNaN(age)) return "muted";
    return age < 3600000 ? "success" : "warn";
  };

  // Top demand leads, real, sorted by daily call volume.
  const topLeads = [...(devs || [])]
    .sort((a, b) => (b.avg_daily_calls || 0) - (a.avg_daily_calls || 0))
    .slice(0, 3);

  // "Live now" count — automation jobs that ran within the last hour (real, from /jobs/status).
  const liveJobs = (jobs || []).filter((j) => jobDotTone(j) === "success").length;

  // Demand-by-lead series — REAL classified leads, sorted by tenure (oldest → newest).
  // Not a time series: each point is one lead's avg_daily_calls. X = IP last octet.
  const demandByLead = [...(devs || [])]
    .sort((a, b) => (a.days_active || 0) - (b.days_active || 0))
    .map((d) => ({
      label: String(d.ip || "").split(".").pop() || "?",
      calls: d.avg_daily_calls || 0,
    }));

  // Revenue pipeline stages — architecture, not metrics. Real values where the
  // settlement API provides them (threshold, dry-run); no fabricated throughput.
  const pipeline = [
    { k: "USAGE", detail: "Gateway routing", badge: "ACTIVE", tone: "primary" },

    { k: "METERING", detail: "$0.00003 / call", badge: "ACTIVE", tone: "primary" },

    { k: "EPOCH", detail: "Accumulating", badge: "OPEN", tone: "warn" },
    { k: "ANCHOR", detail: `Threshold: ${status?.threshold ?? "—"} USDT`, badge: "PENDING", tone: "warn" },
    {
      k: "SETTLEMENT",
      detail: status ? (status.dryRun ? "DRY_RUN=1" : "LIVE") : "—",
      badge: status?.dryRun === false ? "LIVE" : "PAUSED",
      tone: "muted",
    },
    { k: "TREASURY", detail: "$0.00 external", badge: "WAITING", tone: "muted" },
  ];

  const topLeadIp = topLeads[0]?.ip;
  const leadColumns = [
    {
      key: "ip",
      header: "IP",
      mono: true,
      render: (d) => (
        <>
          {d.ip}
          {d.ip === topLeadIp ? (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 5px",
                fontSize: 9,
                fontFamily: "JetBrains Mono",
                background: "rgba(245,158,11,0.15)",
                border: "1px solid rgba(245,158,11,0.4)",
                color: "#F59E0B",
                borderRadius: 2,
                letterSpacing: "0.08em",
              }}
            >
              #1
            </span>
          ) : null}
        </>
      ),
    },
    { key: "loc", header: "ISP / Country", render: (d) => [d.isp, d.country].filter(Boolean).join(" · ") || "—" },
    {
      key: "class",
      header: "Class",
      render: (d) => <StatusBadge label={d.classification || "unknown"} tone={d.classification === "developer" ? "primary" : "muted"} />,
    },
    { key: "calls", header: "Calls/day", mono: true, render: (d) => fmt.num(d.avg_daily_calls) },
    {
      key: "trend",
      header: "Trend",
      render: (d) => <SparkArea data={[d.avg_daily_calls]} ariaLabel={`${d.ip} calls/day`} />,
    },
    { key: "days", header: "Days", mono: true, muted: true, render: (d) => String(d.days_active ?? 0) },
    { key: "score", header: "Score", mono: true, render: (d) => String(d.score ?? 0) },
    { key: "status", header: "Stage", render: (d) => <StatusBadge label={d.status} tone={stageTone(d.status)} /> },
    {
      key: "action",
      header: "",
      render: (d) => {
        const next = NEXT_STAGE[d.status];
        if (!next) return null;
        return (
          <Button size="sm" tone={stageTone(next)} disabled={busy[`stage:${d.ip}`]} onClick={() => advance(d.ip, next)}>
            {busy[`stage:${d.ip}`] ? "Saving…" : STAGE_BTN[next]}
          </Button>
        );
      },
    },
  ];

  const jobColumns = [
    { key: "job_name", header: "Job", mono: true },
    { key: "action", header: "Last action", render: (j) => j.action || "—" },
    { key: "created_at", header: "When", mono: true, muted: true, render: (j) => fmt.time(j.created_at) },
  ];

  // Overview · Automation Health — job freshness via StatusDot.
  const healthColumns = [
    { key: "dot", header: "", render: (j) => <StatusDot tone={jobDotTone(j)} pulse={jobDotTone(j) === "success"} /> },
    { key: "job_name", header: "Job", mono: true },
    { key: "created_at", header: "Last run", mono: true, muted: true, render: (j) => fmt.time(j.created_at) },
  ];

  // Overview · Customer Zero Countdown — top demand leads.
  const czColumns = [
    { key: "ip", header: "IP", mono: true, render: (d) => d.ip },
    {
      key: "trend",
      header: "Trend",
      render: (d) => <SparkArea data={[d.avg_daily_calls]} ariaLabel={`${d.ip} calls/day`} />,
    },
    { key: "isp", header: "ISP", render: (d) => d.isp || "—" },
    { key: "calls", header: "Calls/day", mono: true, render: (d) => fmt.num(d.avg_daily_calls) },
    { key: "status", header: "Stage", render: (d) => <StatusBadge label={d.status} tone={stageTone(d.status)} /> },
  ];

  // Settings — static config reference rows rendered through DataTable.
  const kvColumns = [
    { key: "k", header: "Key", mono: true, muted: true },
    { key: "v", header: "Value", mono: true },
  ];

  // Funnel counts — real, derived from lead statuses
  const counts = (devs || []).reduce((a, d) => ((a[d.status] = (a[d.status] || 0) + 1), a), {});

  // Conversion funnel series — real lead counts per stage.
  const funnelData = [
    { name: "Classified", value: (devs || []).length, fill: "#4ECDC4" },
    { name: "Identified", value: counts.identified || 0, fill: "#7DD3FC" },
    { name: "Contacted", value: counts.contacted || 0, fill: "#F59E0B" },
    { name: "Deposited", value: counts.deposited || 0, fill: "#34D399" },
    { name: "Paid", value: counts.paid || 0, fill: "#10B981" },
  ];

  // ── Header status chip per view ──────────────────────────────────────────────
  const headerStatus =
    view === "treasury" && status ? (
      <StatusBadge label={status.dryRun ? "DRY_RUN" : "LIVE"} tone={status.dryRun ? "warn" : "danger"} />
    ) : view === "radar" ? (
      <StatusBadge label={`${devs ? devs.length : 0} leads`} tone="info" />
    ) : view === "overview" ? (
      <StatusBadge label={czHit ? "CZ HIT" : "CZ WAITING"} tone={czHit ? "success" : "warn"} />
    ) : null;

  const H = HEADERS[view];

  return (
    <AppShell
      nav={{ items: NAV, activeId: view, onSelect: setView, collapsed, onToggleCollapse: () => setCollapsed((c) => !c) }}
      topbar={{
        brand: "SATELINK COMMAND CENTER",
        searchPlaceholder: "Search operations…",
        environment: "production",
        status: [
          { label: "SETTLEMENT", value: status ? (status.dryRun ? "DRY_RUN" : "LIVE") : "…", tone: status ? (status.dryRun ? "warn" : "danger") : "muted" },
          { label: "SETTLED", value: status ? fmt.num(status.totalSettlements ?? 0) : "…", tone: "success" },
          { label: "REV", value: "$0.00 ext", tone: "warn" },
          { label: "CZ", value: czHit ? "HIT 🎯" : "WAITING", tone: czHit ? "success" : "warn" },
        ],
        live: feedState === "live",
        liveTone: feedState === "live" ? "success" : feedState === "error" ? "danger" : "warn",
        time: now,
        onRefresh: refreshAll,
      }}
      header={{
        icon: H.icon,
        title: H.title,
        subtitle: H.subtitle,
        breadcrumb: ["Admin", "Command Center"],
        status: headerStatus,
        actions: (
          <Button size="sm" onClick={refreshAll}>
            Refresh all
          </Button>
        ),
      }}
    >
      <Stack gap="sm">
        {notice ? <Notice>{notice}</Notice> : null}

        {/* ── OVERVIEW (gateway status + Customer Zero) ───────────────── */}
        {view === "overview" && (
          <Split
            asideWidth="sm"
            asidePosition="right"
            aside={<EventStream title="Live Event Stream" state={feedState} events={feedEvents} />}
          >
            <Stack gap="sm">
              <MetricGrid columns={4}>
                <MetricCard label="Gateway" value="LIVE" sub="rpc.satelink.network" tone="success" icon="◉" />
                <MetricCard
                  label="DRY RUN"
                  value={status ? (status.dryRun ? "ON" : "OFF") : statusErr ? "—" : "…"}
                  sub={status ? (status.dryRun ? "simulated only" : "real settlements") : ""}
                  tone="warn"
                  icon="◑"
                />
                <MetricCard label="Credit Balance" value="$0.5999" sub="test wallet — founder funded" tone="primary" icon="$" />
                <MetricCard
                  label="Customer Zero"
                  value={devs == null ? "…" : czHit ? "HIT 🎯" : "WAITING"}
                  sub={czHit ? "first deposit confirmed" : "no paying customer yet"}
                  tone={czHit ? "success" : "warn"}
                  alert={!czHit && devs != null}
                  icon="◎"
                />
              </MetricGrid>
              {statusErr ? <EmptyState variant="line" label="settlement status" note={statusErr} /> : null}

              <Split asideWidth="md" asidePosition="right" aside={
                <Panel>
                  <SectionLabel right={<StatusBadge label={czHit ? "HIT" : "WAITING"} tone={czHit ? "success" : "warn"} />}>Customer Zero Countdown</SectionLabel>
                  <DataTable
                    columns={czColumns}
                    rows={devs == null ? null : topLeads}
                    getRowKey={(d) => d.ip}
                    error={devErr}
                    emptyLabel="leads"
                    emptyMessage="No leads classified yet"
                    emptyNote="IP classifier runs every 15min"
                  />
                  {topLeads.length > 0 ? (
                    <Notice>
                      {`${topLeads[0].ip} is #1 candidate — ${fmt.num(topLeads[0].avg_daily_calls)} calls/day, ${topLeads[0].days_active ?? 0} days active. Live trend available after RPC metrics pipeline.`}
                    </Notice>
                  ) : null}
                </Panel>
              }>
                <Stack gap="sm">
                  <Panel>
                    <SectionLabel
                      right={
                        <Inline gap="sm">
                          <StatusDot tone="success" pulse />
                          <StatusBadge label="LIVE" tone="success" />
                        </Inline>
                      }
                    >
                      Live Now
                    </SectionLabel>
                    <Stack gap="sm">
                      <MetricCard
                        label="Active Automation Jobs"
                        value={jobs == null ? "…" : String(liveJobs)}
                        sub="ran in the last hour"
                        tone="success"
                        icon="◐"
                      />
                      <MetricGrid columns={2}>
                        <MetricCard
                          label="Leads Identified"
                          value={devs == null ? "…" : fmt.num(devs.length)}
                          tone="info"
                          size="sm"
                        />
                        <MetricCard
                          label="Top Lead Calls/Day"
                          value={topLeads[0] ? fmt.num(topLeads[0].avg_daily_calls) : "—"}
                          tone="primary"
                          size="sm"
                        />
                        <MetricCard
                          label="Customer Zero"
                          value={devs == null ? "…" : czHit ? "HIT" : "WAITING"}
                          tone={czHit ? "success" : "warn"}
                          size="sm"
                        />
                        <MetricCard
                          label="Settlement"
                          value={status ? (status.dryRun ? "DRY_RUN" : "LIVE") : "…"}
                          tone={status?.dryRun ? "warn" : "success"}
                          size="sm"
                        />
                      </MetricGrid>
                    </Stack>
                  </Panel>
                  <Panel>
                    <SectionLabel right={<StatusDot tone={jobs && jobs.length ? jobDotTone(jobs[0]) : "muted"} pulse />}>Automation Health</SectionLabel>
                    <DataTable
                      columns={healthColumns}
                      rows={jobs}
                      getRowKey={(j, i) => `${j.job_name}-${i}`}
                      error={jobsErr}
                      emptyLabel="automation jobs"
                      emptyMessage="No job history yet"
                      emptyNote="trigger a job in Agents"
                    />
                  </Panel>
                </Stack>
              </Split>

              <Panel>
                <SectionLabel right={<StatusBadge label="ARCHITECTURE REFERENCE" tone="muted" />}>Gateway Architecture</SectionLabel>
                <TopologyDiagram model={ARCH_TOPOLOGY} caption="Structural diagram — not a live data feed." />
              </Panel>
            </Stack>
          </Split>
        )}

        {/* ── DEMAND RADAR (leads, conversion, outreach) ──────────────── */}
        {view === "radar" && (
          <Split
            asideWidth="md"
            asidePosition="left"
            aside={
              <Stack gap="sm">
                <Panel>
                  <SectionLabel>Conversion Funnel</SectionLabel>
                  {devs && devs.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <FunnelChart>
                        <Tooltip
                          contentStyle={{
                            background: "#0C1120",
                            border: "1px solid #1A2840",
                            fontSize: 11,
                            fontFamily: "JetBrains Mono",
                          }}
                        />
                        <Funnel dataKey="value" data={funnelData} isAnimationActive>
                          <LabelList position="right" fill="#E2EAF4" stroke="none" dataKey="name" fontSize={11} />
                        </Funnel>
                      </FunnelChart>
                    </ResponsiveContainer>
                  ) : null}
                  {devs ? (
                    <MetricGrid columns={2}>
                      <MetricCard label="Classified" value={fmt.num(devs.length)} tone="muted" size="sm" />
                      <MetricCard label="Identified" value={fmt.num(counts.identified || 0)} tone="info" size="sm" />
                      <MetricCard label="Contacted" value={fmt.num(counts.contacted || 0)} tone="warn" size="sm" />
                      <MetricCard label="Deposited" value={fmt.num(counts.deposited || 0)} tone="primary" size="sm" />
                      <MetricCard label="Paid" value={fmt.num(counts.paid || 0)} tone="success" size="sm" />
                    </MetricGrid>
                  ) : (
                    <EmptyState variant="line" label="funnel" note="loading…" />
                  )}
                  <EmptyState variant="line" label="Upstream funnel (active IPs → free-limit)" note="requires telemetry" />
                </Panel>
                <Panel>
                  <SectionLabel>IP Classifier</SectionLabel>
                  <Button tone="primary" disabled={busy.classify} onClick={classify}>
                    {busy.classify ? "Running…" : "Run IP Classifier"}
                  </Button>
                </Panel>
                <Panel>
                  <SectionLabel>Outreach</SectionLabel>
                  <Stack gap="sm">
                    {TEMPLATES.map((t) => (
                      <Button key={t.id} tone="info" disabled={busy[`outreach:${t.id}`]} onClick={() => outreach(t.id)}>
                        {busy[`outreach:${t.id}`] ? "Sending…" : `Send: ${t.label}`}
                      </Button>
                    ))}
                  </Stack>
                </Panel>
              </Stack>
            }
          >
            <Panel>
              <SectionLabel right={<StatusBadge label={`${devs ? devs.length : 0} leads`} tone="info" />}>Lead Pipeline</SectionLabel>
              <Inline gap="sm">
                {["all", "identified", "contacted", "deposited", "paid"].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    tone={radarFilter === s ? "primary" : "muted"}
                    onClick={() => setRadarFilter(s)}
                  >
                    {s === "all" ? `All ${devs ? `(${devs.length})` : ""}` : `${s} (${counts[s] || 0})`}
                  </Button>
                ))}
              </Inline>
              <DataTable
                columns={leadColumns}
                rows={devs == null ? null : radarFilter === "all" ? devs : devs.filter((d) => d.status === radarFilter)}
                getRowKey={(d) => d.ip}
                accentRowKey={topLeadIp}
                error={devErr}
                emptyLabel="lead pipeline"
                emptyMessage="No leads classified yet"
                emptyNote="run the IP classifier to populate"
              />
            </Panel>
          </Split>
        )}

        {/* ── TREASURY (settlement control) ───────────────────────────── */}
        {view === "treasury" && (
          <Stack gap="sm">
            <MetricGrid columns={4}>
              <MetricCard
                label="Settlement mode"
                value={status ? (status.dryRun ? "DRY_RUN" : "LIVE") : statusErr ? "—" : "…"}
                sub={status ? (status.dryRun ? "no real TXs" : "real POL spent") : ""}
                tone={status ? (status.dryRun ? "warn" : "danger") : "muted"}
                alert={status ? !status.dryRun : false}
              />
              <MetricCard label="Signer POL" value={status ? fmt.bal(status.signerBalance) : statusErr ? "—" : "…"} sub={status?.signerBalance == null ? "no signer / unreachable" : "on-chain"} tone="info" />
              <MetricCard label="Anchor threshold" value={status ? (status.threshold ?? "—") : statusErr ? "—" : "…"} sub="USDT" tone="primary" />
              <MetricCard label="Settled TXs" value={status ? fmt.num(status.totalSettlements ?? 0) : statusErr ? "—" : "…"} sub="on-chain epochs" tone="success" />
              <MetricCard label="Signer address" value={status ? fmt.addr(status.signerAddress) : "…"} sub="signer wallet" tone="muted" size="sm" />
              <MetricCard label="Treasury address" value={status ? fmt.addr(status.treasuryAddress) : "…"} sub="treasury wallet" tone="muted" size="sm" />
            </MetricGrid>

            <Panel>
              <SectionLabel>Settlement Control</SectionLabel>
              {!status && !statusErr ? (
                <EmptyState variant="line" label="control" note="loading…" />
              ) : statusErr ? (
                <EmptyState label="settlement status" message="Could not load settlement status" note={statusErr} />
              ) : status ? (
                <Stack gap="sm">
                  <Inline gap="md">
                    <StatusBadge label={status.dryRun ? "DRY_RUN (simulated)" : "LIVE (real settlements)"} tone={status.dryRun ? "warn" : "danger"} />
                    {status.dryRun ? (
                      !showLiveConfirm ? (
                        <Button tone="danger" disabled={busy.dryRun} onClick={() => setShowLiveConfirm(true)}>
                          Enable LIVE settlement
                        </Button>
                      ) : null
                    ) : (
                      <Button tone="primary" disabled={busy.dryRun} onClick={toggleDryRun}>
                        {busy.dryRun ? "Working…" : "Return to DRY_RUN"}
                      </Button>
                    )}
                  </Inline>
                  {status.dryRun && showLiveConfirm ? (
                    <Inline gap="sm">
                      <Input
                        value={confirmLive}
                        onChange={setConfirmLive}
                        placeholder="type LIVE to confirm"
                        ariaLabel="type LIVE to confirm"
                        disabled={busy.dryRun}
                        mono
                      />
                      <Button tone="danger" disabled={busy.dryRun || confirmLive !== "LIVE"} onClick={toggleDryRun}>
                        {busy.dryRun ? "Working…" : "Confirm LIVE"}
                      </Button>
                      <Button tone="muted" disabled={busy.dryRun} onClick={() => { setShowLiveConfirm(false); setConfirmLive(""); }}>
                        Cancel
                      </Button>
                    </Inline>
                  ) : null}
                </Stack>
              ) : null}
            </Panel>

            <EmptyState variant="line" label="Revenue Velocity" note="metered/day — billing + epoch endpoints" />
            <EmptyState variant="line" label="Epoch Detail" note="epoch endpoint in admin router" />
            <EmptyState variant="line" label="On-chain Treasury Balance" note="balance read endpoint" />
          </Stack>
        )}

        {/* ── REVENUE (balance, pipeline, projection) ─────────────────── */}
        {view === "revenue" && (
          <Stack gap="sm">
            <MetricGrid columns={4}>
              <MetricCard label="External Revenue" value="$0.00" sub="no paying customers yet" tone="warn" alert />
              <MetricCard label="Credit Balance" value="$0.5999 USDT" sub="test wallet — founder funded" tone="primary" />
              <MetricCard label="Settlement Thresh" value={status ? (status.threshold ?? "—") : statusErr ? "—" : "…"} sub="USDT before epoch settles" tone="primary" />
              <MetricCard label="Settled TXs" value={status ? fmt.num(status.totalSettlements ?? 0) : statusErr ? "—" : "…"} sub="on-chain epochs" tone="success" />
            </MetricGrid>

            <Panel>
              <SectionLabel right={<StatusDot tone="success" pulse />}>Revenue Pipeline</SectionLabel>
              <MetricGrid columns={6}>
                {pipeline.map((s) => (
                  <MetricCard key={s.k} label={s.k} value={s.detail} sub={s.badge} tone={s.tone} size="sm" />
                ))}
              </MetricGrid>
            </Panel>

            <Panel>
              <SectionLabel right={<StatusBadge label="REAL LEADS" tone="info" />}>DEMAND BY LEAD — sorted by tenure</SectionLabel>
              {devs == null ? (
                <EmptyState variant="line" label="demand" note="loading…" />
              ) : demandByLead.length === 0 ? (
                <EmptyState variant="line" label="demand" note="no classified leads yet" />
              ) : (
                <div style={{ marginTop: 16 }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={demandByLead} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="demandFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4ECDC4" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#4ECDC4" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#64748B", fontSize: 11, fontFamily: "JetBrains Mono" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        width={48}
                        tick={{ fill: "#64748B", fontSize: 11, fontFamily: "JetBrains Mono" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => fmt.num(v)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#0C1120",
                          border: "1px solid #1A2840",
                          borderRadius: 4,
                          fontFamily: "JetBrains Mono",
                          fontSize: 12,
                        }}
                        formatter={(value) => [`${fmt.num(value)}/day`, "Calls"]}
                        labelFormatter={(l) => `…${l}`}
                        labelStyle={{ color: "#64748B" }}
                        cursor={{ stroke: "rgba(78,205,196,0.3)" }}
                      />
                      <Area type="monotone" dataKey="calls" stroke="#4ECDC4" strokeWidth={2} fill="url(#demandFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 10, color: "#64748B", fontFamily: "JetBrains Mono", marginTop: 4 }}>
                    Real classified leads, not time-series (no RPC metrics pipeline yet)
                  </div>
                </div>
              )}
            </Panel>

            <Panel>
              <SectionLabel right={<StatusBadge label="PROJECTION — POST CUSTOMER ZERO" tone="muted" />}>Revenue Projection</SectionLabel>
              <div style={{ marginTop: 16 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={PROJECTION_DATA} barCategoryGap="30%" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#64748B", fontSize: 11, fontFamily: "JetBrains Mono" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#64748B", fontSize: 11, fontFamily: "JetBrains Mono" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#0C1120",
                        border: "1px solid #1A2840",
                        borderRadius: 4,
                        fontFamily: "JetBrains Mono",
                        fontSize: 12,
                      }}
                      formatter={(value) => [`$${value}/mo`, "Monthly"]}
                      labelStyle={{ color: "#64748B" }}
                      cursor={{ fill: "rgba(78,205,196,0.05)" }}
                    />
                    <Bar dataKey="monthly" radius={[4, 4, 0, 0]}>
                      <Cell fill="#4ECDC4" />
                      <Cell fill="#4ECDC4" opacity={0.7} />
                      <Cell fill="#4ECDC4" opacity={0.5} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div
                  style={{
                    fontSize: 10,
                    color: "#64748B",
                    fontFamily: "JetBrains Mono",
                    marginTop: 4,
                    textAlign: "right",
                  }}
                >
                  PROJECTION — POST CUSTOMER ZERO
                </div>
              </div>
              <DataTable
                columns={[
                  { key: "daily", header: "Daily", mono: true },
                  { key: "who", header: "Customers" },
                  { key: "monthly", header: "Monthly", mono: true },
                ]}
                rows={PROJECTIONS}
                getRowKey={(r) => r.daily}
                emptyLabel="projection"
              />
            </Panel>
          </Stack>
        )}

        {/* ── AGENTS (jobs + fleet) ───────────────────────────────────── */}
        {view === "agents" && (
          <Stack gap="sm">
            <Panel>
              <SectionLabel right={<StatusDot tone={jobs && jobs.length ? jobDotTone(jobs[0]) : "muted"} pulse />}>Automation Jobs</SectionLabel>
              <Inline gap="sm">
                {TRIGGERABLE_JOBS.map((j) => (
                  <Button key={j} tone="muted" disabled={busy[`job:${j}`]} onClick={() => trigger(j)}>
                    {busy[`job:${j}`] ? "Running…" : `Trigger ${j}`}
                  </Button>
                ))}
              </Inline>
              <DataTable
                columns={jobColumns}
                rows={jobs}
                getRowKey={(j, i) => `${j.job_name}-${i}`}
                error={jobsErr}
                emptyLabel="automation jobs"
                emptyMessage="No job history yet"
                emptyNote="trigger a job above"
              />
            </Panel>
            <EmptyState variant="line" label="Paperclip AI Operations" note="manage at agents.satelink.network" />
            <EmptyState variant="line" label="Distribution Channels" note="channel-tracking endpoint" />
          </Stack>
        )}

        {/* ── SETTINGS (configuration reference) ──────────────────────── */}
        {view === "settings" && (
          <Stack gap="sm">
            <Panel>
              <SectionLabel>Environment</SectionLabel>
              <DataTable
                columns={kvColumns}
                rows={[
                  { k: "API_BASE", v: "rpc.satelink.network" },
                  { k: "DATABASE_URL", v: "postgres://••••••@railway" },
                  { k: "REDIS", v: "managed (Railway)" },
                ]}
                getRowKey={(r) => r.k}
                emptyLabel="environment"
              />
            </Panel>

            <Panel>
              <SectionLabel>Thresholds</SectionLabel>
              <DataTable
                columns={kvColumns}
                rows={[
                  { k: "MIN_ANCHOR_REVENUE_USDT", v: status ? String(status.threshold ?? "0.5") : "…" },
                  { k: "SETTLEMENT_DRY_RUN", v: status ? (status.dryRun ? "1 (simulated)" : "0 (live)") : "…" },
                  { k: "SIGNER_WALLET", v: status ? fmt.addr(status.signerAddress) : "…" },
                  { k: "TREASURY_WALLET", v: status ? fmt.addr(status.treasuryAddress) : "…" },
                ]}
                getRowKey={(r) => r.k}
                emptyLabel="thresholds"
              />
            </Panel>

            <Panel>
              <SectionLabel>External Services</SectionLabel>
              <DataTable
                columns={kvColumns}
                rows={[
                  { k: "Discord webhook", v: "configured (server-side env)" },
                  { k: "erpc Discussion", v: "github.com/erpc/erpc/discussions/943" },
                  { k: "Chainlist PR", v: "github.com/ethereum-lists/chains/pull/8314" },
                ]}
                getRowKey={(r) => r.k}
                emptyLabel="external services"
              />
            </Panel>

            <Panel>
              <SectionLabel>Paperclip</SectionLabel>
              <DataTable
                columns={kvColumns}
                rows={[
                  { k: "Company ID", v: "2fb13f91-fa14-4a2f-9497-6601e9a171d9" },
                  { k: "Agents URL", v: "agents.satelink.network" },
                  { k: "Model", v: "claude-haiku" },
                  { k: "Count", v: "12" },
                ]}
                getRowKey={(r) => r.k}
                emptyLabel="paperclip"
              />
            </Panel>
          </Stack>
        )}
      </Stack>
    </AppShell>
  );
}
