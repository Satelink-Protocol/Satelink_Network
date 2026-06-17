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
  AppShell,
  Button,
  DataTable,
  DonutChart,
  EmptyState,
  EventStream,
  Inline,
  MetricCard,
  MetricGrid,
  Notice,
  Panel,
  SectionLabel,
  SeriesChart,
  Split,
  Stack,
  StatusBadge,
  TopologyDiagram,
} from "@/components/satelink-os";

// ── Static config ─────────────────────────────────────────────────────────────
const NAV = [
  { id: "network", icon: "◈", label: "Network Ops" },
  { id: "intel", icon: "◉", label: "Intelligence" },
  { id: "revenue", icon: "⊕", label: "Revenue Ops" },
  { id: "treasury", icon: "◎", label: "Treasury" },
  { id: "agents", icon: "◐", label: "Agent Ops" },
  { id: "security", icon: "⊗", label: "Security" },
];

const HEADERS = {
  network: { icon: "◈", title: "Network Operations", subtitle: "Gateway architecture & live event stream" },
  intel: { icon: "◉", title: "Intelligence", subtitle: "Traffic, providers & geo — telemetry pending" },
  revenue: { icon: "⊕", title: "Revenue Operations", subtitle: "Lead pipeline, conversion & outreach" },
  treasury: { icon: "◎", title: "Treasury", subtitle: "Settlement control & on-chain status" },
  agents: { icon: "◐", title: "Agent Operations", subtitle: "Automation jobs & agent fleet" },
  security: { icon: "⊗", title: "Security", subtitle: "SOC posture — telemetry pending" },
};

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
  const [view, setView] = useState("network");
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState("");

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
    if (goingLive) {
      const typed = window.prompt("This enables LIVE settlement. Real POL will be spent.\n\nType LIVE to confirm:");
      if (typed !== "LIVE") {
        flash("DRY_RUN toggle cancelled — confirmation not matched");
        return;
      }
    }
    setBusyFor("dryRun", true);
    try {
      const r = await adminFetch("/settlement/dry-run", { method: "POST", body: { enabled: !status.dryRun } });
      if (!r.ok) throw new Error(r.error || "toggle failed");
      const persistNote = r.persistent === false ? " Change is in-process only — set RAILWAY_TOKEN for a persistent Railway update." : "";
      flash(`Settlement is now ${r.dryRun ? "DRY_RUN (simulated)" : "LIVE"}.${persistNote}`);
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

  const statusCards = (
    <>
      <MetricCard
        label="Settlement mode"
        value={status ? (status.dryRun ? "DRY_RUN" : "LIVE") : statusErr ? "—" : "…"}
        tone={status ? (status.dryRun ? "warn" : "danger") : "muted"}
        alert={status ? !status.dryRun : false}
      />
      <MetricCard label="Signer POL" value={status ? fmt.bal(status.signerBalance) : statusErr ? "—" : "…"} tone="info" />
      <MetricCard label="Anchor threshold" value={status ? (status.threshold ?? "—") : statusErr ? "—" : "…"} sub="USDT" tone="primary" />
      <MetricCard label="Settled TXs" value={status ? fmt.num(status.totalSettlements ?? 0) : statusErr ? "—" : "…"} sub="on-chain epochs" tone="success" />
    </>
  );

  const leadColumns = [
    { key: "ip", header: "IP", mono: true, render: (d) => d.ip },
    { key: "loc", header: "ISP / Country", render: (d) => [d.isp, d.country].filter(Boolean).join(" · ") || "—" },
    {
      key: "class",
      header: "Class",
      render: (d) => <StatusBadge label={d.classification || "unknown"} tone={d.classification === "developer" ? "primary" : "muted"} />,
    },
    { key: "calls", header: "Calls/day", mono: true, render: (d) => fmt.num(d.avg_daily_calls) },
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

  // Funnel counts — real, derived from lead statuses
  const counts = (devs || []).reduce((a, d) => ((a[d.status] = (a[d.status] || 0) + 1), a), {});

  // ── Header status chip per view ──────────────────────────────────────────────
  const headerStatus =
    view === "treasury" && status ? (
      <StatusBadge label={status.dryRun ? "DRY_RUN" : "LIVE"} tone={status.dryRun ? "warn" : "danger"} />
    ) : view === "revenue" ? (
      <StatusBadge label={`${devs ? devs.length : 0} leads`} tone="info" />
    ) : view === "security" ? (
      <StatusBadge label="telemetry pending" tone="muted" />
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

        {/* ── NETWORK OPS ─────────────────────────────────────────────── */}
        {view === "network" && (
          <Split
            asideWidth="sm"
            asidePosition="right"
            aside={<EventStream title="Live Event Stream" state={feedState} events={feedEvents} />}
          >
            <Stack gap="sm">
              <Panel>
                <SectionLabel right={<StatusBadge label="DESIGN" tone="muted" />}>Network Architecture</SectionLabel>
                <TopologyDiagram model={ARCH_TOPOLOGY} caption="Structural diagram — not a live data feed." />
              </Panel>
              <MetricGrid columns={4}>{statusCards}</MetricGrid>
              {statusErr ? <EmptyState variant="line" label="settlement status" note={statusErr} /> : null}
              <EmptyState variant="line" label="RPC Metrics · 24h Volume · Provider Pool" note="requires telemetry pipeline" />
            </Stack>
          </Split>
        )}

        {/* ── INTELLIGENCE (telemetry pending) ────────────────────────── */}
        {view === "intel" && (
          <Split asideWidth="sm" asidePosition="right" aside={<DonutChart title="Traffic by Country" data={null} />}>
            <Stack gap="sm">
              <SeriesChart title="Latency Distribution" type="bar" data={null} />
              <EmptyState label="Provider Intelligence Matrix" message="Telemetry backend not yet implemented" note="latency · success% · traffic share" />
              <EmptyState variant="line" label="Top Sources / ASN / Method" note="aggregation endpoint" />
              <EmptyState variant="line" label="Real per-IP classification" note="see Revenue Ops → Lead Pipeline" />
            </Stack>
          </Split>
        )}

        {/* ── REVENUE OPS (leads, conversion, outreach) ───────────────── */}
        {view === "revenue" && (
          <Split
            asideWidth="md"
            asidePosition="left"
            aside={
              <Stack gap="sm">
                <Panel>
                  <SectionLabel>Conversion Funnel</SectionLabel>
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
              <DataTable
                columns={leadColumns}
                rows={devs}
                getRowKey={(d) => d.ip}
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
            {statusErr ? <EmptyState variant="line" label="settlement status" note={statusErr} /> : null}

            <Panel>
              <SectionLabel>Settlement Control</SectionLabel>
              {!status && !statusErr ? (
                <EmptyState variant="line" label="control" note="loading…" />
              ) : status ? (
                <Inline gap="md">
                  <StatusBadge label={status.dryRun ? "DRY_RUN (simulated)" : "LIVE (real settlements)"} tone={status.dryRun ? "warn" : "danger"} />
                  <Button tone={status.dryRun ? "danger" : "primary"} disabled={busy.dryRun} onClick={toggleDryRun}>
                    {busy.dryRun ? "Working…" : status.dryRun ? "Enable LIVE settlement" : "Return to DRY_RUN"}
                  </Button>
                </Inline>
              ) : null}
            </Panel>

            <EmptyState variant="line" label="Revenue Velocity" note="metered/day — billing + epoch endpoints" />
            <EmptyState variant="line" label="Epoch Detail" note="epoch endpoint in admin router" />
            <EmptyState variant="line" label="On-chain Treasury Balance" note="balance read endpoint" />
          </Stack>
        )}

        {/* ── AGENT OPS (jobs + fleet) ────────────────────────────────── */}
        {view === "agents" && (
          <Stack gap="sm">
            <Panel>
              <SectionLabel>Automation Jobs</SectionLabel>
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
                emptyMessage="No jobs have run yet"
                emptyNote="trigger a job above"
              />
            </Panel>
            <EmptyState variant="line" label="Paperclip AI Operations" note="manage at agents.satelink.network" />
            <EmptyState variant="line" label="Distribution Channels" note="channel-tracking endpoint" />
          </Stack>
        )}

        {/* ── SECURITY (telemetry pending) ────────────────────────────── */}
        {view === "security" && (
          <Stack gap="sm">
            <EmptyState label="SOC Metrics" message="Telemetry backend not yet implemented" note="blocked IPs · rate events · gate hits · auth failures" />
            <EmptyState variant="line" label="Security Event Feed" note="threat-event store" />
            <EmptyState variant="line" label="Known Threat Patterns" note="detection pipeline" />
            <EmptyState variant="line" label="Anomaly Scores" note="anomaly engine" />
          </Stack>
        )}
      </Stack>
    </AppShell>
  );
}
