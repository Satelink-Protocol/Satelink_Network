"use client";

import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, Funnel, FunnelChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AppShell, Button, DataTable, EmptyState, Inline, Input, MetricCard, MetricGrid, Notice, Panel, SectionLabel, Split, Stack, StatusBadge, StatusDot, TopologyDiagram,
  FilterPanel, FilterGroup, FilterCheckbox, RevenueProjectionChart, LeadPipelineTable, CustomerZeroPanel, LiveEventStream, AutomationHealth
} from "@/components/satelink-os";
import { NAV, HEADERS, PROJECTIONS, PROJECTION_DATA, ARCH_TOPOLOGY, TEMPLATES, TRIGGERABLE_JOBS, stageTone, fmt } from "./constants";

async function adminFetch(path, opts = {}) {
  const res = await fetch("/api/admin-proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, method: opts.method || "GET", body: opts.body }) });
  return res.json();
}

export default function AdminCommandCenter() {
  const [view, setView] = useState("radar");
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState("");
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);
  const [confirmLive, setConfirmLive] = useState("");
  const [stages, setStages] = useState({ identified: true, contacted: true, deposited: true, paid: true });
  const [classes, setClasses] = useState({ developer: true, crawler: true, new: true });
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
  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 6000); };
  const loadStatus = useCallback(async () => { setStatusErr(null); try { const r = await adminFetch("/settlement/status"); if (!r.ok) throw new Error(r.error || "failed"); setStatus(r); } catch (e) { setStatusErr(e.message); } }, []);
  const loadDevs = useCallback(async () => { setDevErr(null); try { const r = await adminFetch("/intel/developers"); if (!r.ok) throw new Error(r.error || "failed"); setDevs(Array.isArray(r.developers) ? r.developers : []); } catch (e) { setDevErr(e.message); setDevs([]); } }, []);
  const loadJobs = useCallback(async () => { setJobsErr(null); try { const r = await adminFetch("/jobs/status"); if (!r.ok) throw new Error(r.error || "failed"); setJobs(Array.isArray(r.jobs) ? r.jobs : []); } catch (e) { setJobsErr(e.message); setJobs([]); } }, []);
  const refreshAll = useCallback(() => { loadStatus(); loadDevs(); loadJobs(); }, [loadStatus, loadDevs, loadJobs]);

  useEffect(() => { refreshAll(); const t = setInterval(() => setNow(new Date().toLocaleTimeString("en-US", { hour12: false })), 1000); return () => clearInterval(t); }, [refreshAll]);
  useEffect(() => {
    let es; try { es = new EventSource("/api/admin-proxy?stream=live/feed"); es.onmessage = (ev) => { try { const msg = JSON.parse(ev.data); if (msg.type === "connected") setFeedState("live"); else if (msg.type === "log" && msg.data) { setFeedState("live"); setFeed((f) => [msg.data, ...f].slice(0, 80)); } } catch {} }; es.onerror = () => setFeedState("error"); } catch { setFeedState("error"); }
    return () => { try { es && es.close(); } catch {} };
  }, []);

  const toggleDryRun = async () => {
    if (!status || (status.dryRun === true && confirmLive !== "LIVE")) return;
    setBusyFor("dryRun", true);
    try { const r = await adminFetch("/settlement/dry-run", { method: "POST", body: { enabled: !status.dryRun } }); if (!r.ok) throw new Error(r.error || "failed"); flash(`Settlement is ${r.dryRun ? "DRY_RUN" : "LIVE"}`); setShowLiveConfirm(false); setConfirmLive(""); await loadStatus(); } catch (e) { flash(`Failed: ${e.message}`); } finally { setBusyFor("dryRun", false); }
  };
  const advance = async (ip, stage) => {
    setBusyFor(`stage:${ip}`, true);
    try { const r = await adminFetch(`/intel/developer/${ip}/stage`, { method: "PATCH", body: { stage } }); if (!r.ok) throw new Error(r.error || "failed"); setDevs((ds) => (ds || []).map((d) => d.ip === ip ? { ...d, status: stage } : d)); flash(`${ip} → ${stage}`); } catch (e) { flash(`Failed: ${e.message}`); } finally { setBusyFor(`stage:${ip}`, false); }
  };
  const outreach = async (tId) => {
    setBusyFor(`outreach:${tId}`, true);
    try { const r = await adminFetch("/outreach/discord/post", { method: "POST", body: { templateId: tId } }); if (!r.ok) throw new Error(r.error || "failed"); flash(`Sent outreach`); loadJobs(); } catch (e) { flash(`Failed: ${e.message}`); } finally { setBusyFor(`outreach:${tId}`, false); }
  };
  const trigger = async (jId) => {
    setBusyFor(`job:${jId}`, true);
    try { const r = await adminFetch(`/jobs/trigger/${jId}`, { method: "POST" }); if (!r.ok) throw new Error(r.error || "failed"); flash(`Triggered ${jId}`); await loadJobs(); } catch (e) { flash(`Failed: ${e.message}`); } finally { setBusyFor(`job:${jId}`, false); }
  };
  const classify = async () => {
    setBusyFor("classify", true);
    try { const r = await adminFetch("/intel/classify", { method: "POST" }); if (!r.ok) throw new Error(r.error || "failed"); flash("Classifier completed"); await loadDevs(); } catch (e) { flash(`Failed: ${e.message}`); } finally { setBusyFor("classify", false); }
  };

  const feedEvents = feed.map((e, i) => ({ id: e.id ?? i, time: fmt.time(e.created_at), source: e.job_name || "log", message: e.action || "—" }));
  const czHit = (devs || []).some((d) => d.status === "deposited" || d.status === "paid");
  const jobDotTone = (j) => /error|fail/i.test(j.action || "") ? "danger" : j.created_at && (Date.now() - new Date(j.created_at).getTime()) < 3600000 ? "success" : "warn";
  const topLeads = [...(devs || [])].sort((a, b) => (b.avg_daily_calls || 0) - (a.avg_daily_calls || 0)).slice(0, 3);
  const liveJobs = (jobs || []).filter((j) => jobDotTone(j) === "success").length;
  const demandByLead = [...(devs || [])].sort((a, b) => (a.days_active || 0) - (b.days_active || 0)).map((d) => ({ label: String(d.ip || "").split(".").pop() || "?", calls: d.avg_daily_calls || 0 }));
  const pipeline = [
    { k: "USAGE", detail: "Gateway routing", badge: "ACTIVE", tone: "primary" }, { k: "METERING", detail: "$0.00003 / call", badge: "ACTIVE", tone: "primary" },
    { k: "EPOCH", detail: "Accumulating", badge: "OPEN", tone: "warn" }, { k: "ANCHOR", detail: `${status?.threshold ?? "—"} USDT`, badge: "PENDING", tone: "warn" },
    { k: "SETTLEMENT", detail: status ? (status.dryRun ? "DRY_RUN=1" : "LIVE") : "—", badge: status?.dryRun === false ? "LIVE" : "PAUSED", tone: "muted" }, { k: "TREASURY", detail: "$0.00 external", badge: "WAITING", tone: "muted" }
  ];
  const maxCalls = Math.max(...(devs || []).map((d) => d.avg_daily_calls || 1), 150000);
  const filteredDevs = devs == null ? null : devs.filter((d) => (stages[d.status] ?? false) && (d.classification ? (classes[d.classification] ?? true) : true));
  const counts = (devs || []).reduce((a, d) => ((a[d.status] = (a[d.status] || 0) + 1), a), {});
  const funnelData = [{ name: "Classified", value: (devs || []).length, fill: "#4e9eff" }, { name: "Identified", value: counts.identified || 0, fill: "#53b1fd" }, { name: "Contacted", value: counts.contacted || 0, fill: "#f5a623" }, { name: "Deposited", value: counts.deposited || 0, fill: "#32d583" }, { name: "Paid", value: counts.paid || 0, fill: "#0aab53" }];

  const headerStatus = view === "treasury" && status ? <StatusBadge label={status.dryRun ? "DRY_RUN" : "LIVE"} tone={status.dryRun ? "warn" : "danger"} /> : view === "radar" ? <StatusBadge label={`${devs ? devs.length : 0} leads`} tone="info" /> : view === "overview" ? <StatusBadge label={czHit ? "CZ HIT" : "CZ WAITING"} tone={czHit ? "success" : "warn"} /> : null;
  const H = HEADERS[view];

  return (
    <AppShell
      nav={{ items: NAV, activeId: view, onSelect: setView, collapsed, onToggleCollapse: () => setCollapsed((c) => !c) }}
      topbar={{
        brand: "SATELINK COMMAND CENTER", searchPlaceholder: "Search operations…", environment: "production",
        status: [
          { label: "SETTLEMENT", value: status ? (status.dryRun ? "DRY_RUN" : "LIVE") : "…", tone: status ? (status.dryRun ? "warn" : "danger") : "muted" },
          { label: "SETTLED", value: status ? fmt.num(status.totalSettlements ?? 0) : "…", tone: "success" }, { label: "REV", value: "$0.00 ext", tone: "warn" }, { label: "CZ", value: czHit ? "HIT 🎯" : "WAITING", tone: czHit ? "success" : "warn" }
        ],
        live: feedState === "live", liveTone: feedState === "live" ? "success" : feedState === "error" ? "danger" : "warn", time: now, onRefresh: refreshAll
      }}
      header={{ icon: H.icon, title: H.title, subtitle: H.subtitle, breadcrumb: ["Admin", "Command Center"], status: headerStatus, actions: <Button size="sm" onClick={refreshAll}>Refresh all</Button> }}
    >
      <Stack gap="sm">
        {notice && <Notice>{notice}</Notice>}

        {view === "overview" && (
          <Split aside={<LiveEventStream title="Live Event Stream" state={feedState} events={feedEvents} />} asidePosition="right" asideWidth="sm">
            <Stack gap="sm">
              <MetricGrid columns={4}>
                <MetricCard label="Gateway" value="LIVE" sub="rpc.satelink.network" tone="success" />
                <MetricCard label="DRY RUN" value={status ? (status.dryRun ? "ON" : "OFF") : statusErr ? "—" : "…"} sub={status ? (status.dryRun ? "simulated only" : "real settlements") : ""} tone="warn" />
                <MetricCard label="Credit Balance" value="$0.5999" sub="test wallet — founder funded" tone="primary" />
                <MetricCard label="Customer Zero" value={devs == null ? "…" : czHit ? "HIT 🎯" : "WAITING"} sub={czHit ? "first deposit confirmed" : "no paying customer yet"} tone={czHit ? "success" : "warn"} alert={!czHit && devs != null} />
              </MetricGrid>
              <Split aside={<CustomerZeroPanel leads={devs == null ? null : topLeads} czHit={czHit} />} asidePosition="right" asideWidth="md">
                <Stack gap="sm">
                  <Panel title="Live Now" headerRight={<Inline gap="sm"><StatusDot tone="success" pulse /><StatusBadge label="LIVE" tone="success" /></Inline>}>
                    <MetricCard label="Active Automation Jobs" value={jobs == null ? "…" : String(liveJobs)} sub="ran in the last hour" tone="success" />
                  </Panel>
                  <Panel title="Automation Health" headerRight={<StatusDot tone={jobs && jobs.length ? jobDotTone(jobs[0]) : "muted"} pulse />}>
                    <AutomationHealth jobs={jobs} jobsErr={jobsErr} jobDotTone={jobDotTone} />
                  </Panel>
                </Stack>
              </Split>
              <Panel title="Gateway Architecture" headerRight={<StatusBadge label="ARCHITECTURE REFERENCE" tone="muted" />}>
                <TopologyDiagram model={ARCH_TOPOLOGY} caption="Structural diagram — not a live data feed." />
              </Panel>
            </Stack>
          </Split>
        )}

        {view === "radar" && (
          <Split
            asideWidth="md" asidePosition="left"
            aside={
              <FilterPanel title="Filters">
                <FilterGroup title="Lead Stage">
                  {["identified", "contacted", "deposited", "paid"].map((stg) => (
                    <FilterCheckbox key={stg} label={stg.toUpperCase()} count={counts[stg] || 0} checked={stages[stg]} onChange={(chk) => setStages((prev) => ({ ...prev, [stg]: chk }))} />
                  ))}
                </FilterGroup>
                <FilterGroup title="Classification">
                  {["developer", "crawler", "new"].map((cls) => (
                    <FilterCheckbox key={cls} label={cls.toUpperCase()} count={(devs || []).filter((d) => d.classification === cls).length} checked={classes[cls]} onChange={(chk) => setClasses((prev) => ({ ...prev, [cls]: chk }))} />
                  ))}
                </FilterGroup>
                <FilterGroup title="Classifier & Actions">
                  <Stack gap="xs">
                    <Button tone="primary" size="sm" disabled={busy.classify} onClick={classify} style={{ width: "100%" }}>{busy.classify ? "Classifying..." : "Run IP Classifier"}</Button>
                    {TEMPLATES.map((t) => (
                      <Button key={t.id} tone="info" size="sm" disabled={busy[`outreach:${t.id}`]} onClick={() => outreach(t.id)} style={{ width: "100%", marginTop: "4px" }}>{busy[`outreach:${t.id}`] ? "Sending..." : `Send: ${t.label}`}</Button>
                    ))}
                  </Stack>
                </FilterGroup>
              </FilterPanel>
            }
          >
            <Stack gap="sm">
              <Panel title="Conversion Funnel">
                <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "280px" }}>
                    {devs && devs.length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <FunnelChart>
                          <Tooltip contentStyle={{ background: "#1a1d27", border: "1px solid #252838", fontSize: 11, fontFamily: "JetBrains Mono", borderRadius: 4 }} />
                          <Funnel dataKey="value" data={funnelData} isAnimationActive><LabelList position="right" fill="#b4bcd0" stroke="none" dataKey="name" fontSize={10} /></Funnel>
                        </FunnelChart>
                      </ResponsiveContainer>
                    ) : <EmptyState variant="line" label="funnel" note="loading…" />}
                  </div>
                  <div style={{ flex: "0 0 320px" }}>
                    {devs && <MetricGrid columns={2}>
                      <MetricCard label="Classified" value={fmt.num(devs.length)} tone="muted" size="sm" />
                      <MetricCard label="Identified" value={fmt.num(counts.identified || 0)} tone="info" size="sm" />
                      <MetricCard label="Contacted" value={fmt.num(counts.contacted || 0)} tone="warn" size="sm" />
                      <MetricCard label="Deposited" value={fmt.num(counts.deposited || 0)} tone="primary" size="sm" />
                      <MetricCard label="Paid" value={fmt.num(counts.paid || 0)} tone="success" size="sm" />
                    </MetricGrid>}
                  </div>
                </div>
              </Panel>
              <Panel title="Lead Pipeline" headerRight={<StatusBadge label={`${filteredDevs ? filteredDevs.length : 0} filtered`} tone="info" />} flush>
                <LeadPipelineTable devs={filteredDevs} topLeadIp={topLeads[0]?.ip} maxCalls={maxCalls} busy={busy} devErr={devErr} advance={advance} />
              </Panel>
            </Stack>
          </Split>
        )}

        {view === "treasury" && (
          <Stack gap="sm">
            <MetricGrid columns={4}>
              <MetricCard label="Settlement mode" value={status ? (status.dryRun ? "DRY_RUN" : "LIVE") : statusErr ? "—" : "…"} sub={status ? (status.dryRun ? "no real TXs" : "real POL spent") : ""} tone={status ? (status.dryRun ? "warn" : "danger") : "muted"} alert={status ? !status.dryRun : false} />
              <MetricCard label="Signer POL" value={status ? fmt.bal(status.signerBalance) : statusErr ? "—" : "…"} sub={status?.signerBalance == null ? "no signer / unreachable" : "on-chain"} tone="info" />
              <MetricCard label="Anchor threshold" value={status ? (status.threshold ?? "—") : statusErr ? "—" : "…"} sub="USDT" tone="primary" />
              <MetricCard label="Settled TXs" value={status ? fmt.num(status.totalSettlements ?? 0) : statusErr ? "—" : "…"} sub="on-chain epochs" tone="success" />
            </MetricGrid>
            <Panel title="Settlement Control">
              {status && <Stack gap="sm">
                <Inline gap="md">
                  <StatusBadge label={status.dryRun ? "DRY_RUN (simulated)" : "LIVE (real settlements)"} tone={status.dryRun ? "warn" : "danger"} />
                  {status.dryRun ? (!showLiveConfirm && <Button tone="danger" disabled={busy.dryRun} onClick={() => setShowLiveConfirm(true)}>Enable LIVE settlement</Button>) : <Button tone="primary" disabled={busy.dryRun} onClick={toggleDryRun}>{busy.dryRun ? "Working…" : "Return to DRY_RUN"}</Button>}
                </Inline>
                {status.dryRun && showLiveConfirm && <Inline gap="sm">
                  <Input value={confirmLive} onChange={setConfirmLive} placeholder="type LIVE to confirm" disabled={busy.dryRun} mono />
                  <Button tone="danger" disabled={busy.dryRun || confirmLive !== "LIVE"} onClick={toggleDryRun}>{busy.dryRun ? "Working…" : "Confirm LIVE"}</Button>
                  <Button tone="muted" disabled={busy.dryRun} onClick={() => { setShowLiveConfirm(false); setConfirmLive(""); }}>Cancel</Button>
                </Inline>}
              </Stack>}
            </Panel>
          </Stack>
        )}

        {view === "revenue" && (
          <Stack gap="sm">
            <MetricGrid columns={4}>
              <MetricCard label="External Revenue" value="$0.00" sub="no paying customers yet" tone="warn" alert />
              <MetricCard label="Credit Balance" value="$0.5999 USDT" sub="test wallet — founder funded" tone="primary" />
              <MetricCard label="Settlement Thresh" value={status ? (status.threshold ?? "—") : statusErr ? "—" : "…"} sub="USDT before epoch settles" tone="primary" />
              <MetricCard label="Settled TXs" value={status ? fmt.num(status.totalSettlements ?? 0) : statusErr ? "—" : "…"} sub="on-chain epochs" tone="success" />
            </MetricGrid>
            <Panel title="Revenue Pipeline" headerRight={<StatusDot tone="success" pulse />}>
              <MetricGrid columns={6}>
                {pipeline.map((s) => <MetricCard key={s.k} label={s.k} value={s.detail} sub={s.badge} tone={s.tone} size="sm" />)}
              </MetricGrid>
            </Panel>
            <Panel title="Demand By Lead — sorted by tenure" headerRight={<StatusBadge label="REAL LEADS" tone="info" />}>
              {devs && <div style={{ marginTop: 4 }}>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={demandByLead} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs><linearGradient id="demandFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4e9eff" stopOpacity={0.35} /><stop offset="100%" stopColor="#4e9eff" stopOpacity={0.03} /></linearGradient></defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#7c85a2", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                    <YAxis width={44} tick={{ fill: "#7c85a2", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt.num(v)} />
                    <Tooltip contentStyle={{ background: "#1a1d27", border: "1px solid #252838", borderRadius: 4, fontFamily: "JetBrains Mono", fontSize: 12 }} formatter={(value) => [`${fmt.num(value)}/day`, "Calls"]} labelFormatter={(l) => `…${l}`} labelStyle={{ color: "#7c85a2" }} cursor={{ stroke: "rgba(78,158,255,0.3)" }} />
                    <Area type="monotone" dataKey="calls" stroke="#4e9eff" strokeWidth={1.5} fill="url(#demandFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>}
            </Panel>
            <Panel title="Revenue Projection" headerRight={<StatusBadge label="PROJECTION — POST CUSTOMER ZERO" tone="muted" />}>
              <RevenueProjectionChart data={PROJECTION_DATA} />
            </Panel>
          </Stack>
        )}

        {view === "agents" && (
          <Stack gap="sm">
            <Panel title="Automation Jobs" headerRight={<StatusDot tone={jobs && jobs.length ? jobDotTone(jobs[0]) : "muted"} pulse />}>
              <Inline gap="sm" style={{ marginBottom: "12px" }}>
                {TRIGGERABLE_JOBS.map((j) => (
                  <Button key={j} tone="muted" disabled={busy[`job:${j}`]} onClick={() => trigger(j)}>{busy[`job:${j}`] ? "Running…" : `Trigger ${j}`}</Button>
                ))}
              </Inline>
              <DataTable columns={[{ key: "job_name", header: "Job", mono: true }, { key: "action", header: "Last action", render: (j) => j.action || "—" }, { key: "created_at", header: "When", mono: true, muted: true, render: (j) => fmt.time(j.created_at) }]} rows={jobs} getRowKey={(j, i) => `${j.job_name}-${i}`} error={jobsErr} />
            </Panel>
          </Stack>
        )}

        {view === "settings" && (
          <Stack gap="sm">
            <Panel title="Environment">
              <DataTable columns={[{ key: "k", header: "Key", mono: true, muted: true }, { key: "v", header: "Value", mono: true }]} rows={[{ k: "API_BASE", v: "rpc.satelink.network" }, { k: "DATABASE_URL", v: "postgres://••••••@railway" }, { k: "REDIS", v: "managed (Railway)" }]} getRowKey={(r) => r.k} />
            </Panel>
            <Panel title="Thresholds">
              <DataTable columns={[{ key: "k", header: "Key", mono: true, muted: true }, { key: "v", header: "Value", mono: true }]} rows={[{ k: "MIN_ANCHOR_REVENUE_USDT", v: status ? String(status.threshold ?? "0.5") : "…" }, { k: "SETTLEMENT_DRY_RUN", v: status ? (status.dryRun ? "1 (simulated)" : "0 (live)") : "…" }]} getRowKey={(r) => r.k} />
            </Panel>
          </Stack>
        )}
      </Stack>
    </AppShell>
  );
}
