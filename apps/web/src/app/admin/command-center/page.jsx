"use client";

/**
 * Admin Command Center
 *
 * Every call goes through the server-side proxy at /api/admin-proxy, which
 * injects the ADMIN_TOKEN header server-side and forwards to
 * https://rpc.satelink.network/admin/*. The token never reaches the browser,
 * and there are no NEXT_PUBLIC_ env vars here.
 *
 * No mock data — every value is fetched live. Empty arrays render "No data yet".
 */

import { useCallback, useEffect, useState } from "react";

// adminFetch('/intel/developers')                -> GET  /admin/intel/developers
// adminFetch('/jobs/trigger/ip-classifier', {method:'POST'}) -> POST /admin/jobs/trigger/ip-classifier
async function adminFetch(path, opts = {}) {
  const res = await fetch("/api/admin-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, method: opts.method || "GET", body: opts.body }),
  });
  return res.json();
}

const TEMPLATES = [
  { id: "erpc-provider", label: "erpc provider intro" },
  { id: "followup-72h", label: "72h follow-up" },
];

const TRIGGERABLE_JOBS = ["ip-classifier", "customer-zero", "outreach"];

const C = {
  bg: "#0b0f14",
  panel: "#131a22",
  border: "#243140",
  text: "#e6edf3",
  dim: "#8b9bb0",
  accent: "#1affd4",
  danger: "#ff5d6c",
  warn: "#ffb454",
};

const panel = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 18,
  marginBottom: 20,
};

export default function AdminCommandCenter() {
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(null);
  const [devs, setDevs] = useState(null); // null = loading, [] = empty
  const [devErr, setDevErr] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [jobsErr, setJobsErr] = useState(null);
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState(null);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 5000);
  };
  const setBusyFor = (k, v) => setBusy((b) => ({ ...b, [k]: v }));

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

  useEffect(() => {
    loadStatus();
    loadDevs();
    loadJobs();
  }, [loadStatus, loadDevs, loadJobs]);

  // ── Section 4: settlement toggle with typed LIVE confirmation ────────────────
  const toggleDryRun = async () => {
    if (!status) return;
    const goingLive = status.dryRun === true; // currently safe → about to enable live
    if (goingLive) {
      const typed = window.prompt(
        "This enables LIVE settlement. Real POL will be spent.\n\nType LIVE to confirm:"
      );
      if (typed !== "LIVE") {
        flash("DRY_RUN toggle cancelled — confirmation not matched");
        return;
      }
    }
    setBusyFor("dryRun", true);
    try {
      // API field `enabled` IS the dryRun value: enabled=false turns live ON.
      const r = await adminFetch("/settlement/dry-run", {
        method: "POST",
        body: { enabled: !status.dryRun },
      });
      if (!r.ok) throw new Error(r.error || "toggle failed");
      flash(
        `Settlement is now ${r.dryRun ? "DRY_RUN (simulated)" : "LIVE"}${
          r.persistent === false ? " — in-process only, not persisted across redeploys" : ""
        }`
      );
      await loadStatus();
    } catch (e) {
      flash(`Toggle failed: ${e.message}`);
    } finally {
      setBusyFor("dryRun", false);
    }
  };

  // ── Section 3: outreach ──────────────────────────────────────────────────────
  const postOutreach = async (templateId) => {
    setBusyFor(`outreach:${templateId}`, true);
    try {
      const r = await adminFetch("/outreach/discord/post", {
        method: "POST",
        body: { templateId },
      });
      if (!r.ok) throw new Error(r.error || "post failed");
      flash(`Outreach sent: ${r.template || templateId}${r.target ? ` → ${r.target}` : ""}`);
      loadJobs();
    } catch (e) {
      flash(`Outreach failed: ${e.message}`);
    } finally {
      setBusyFor(`outreach:${templateId}`, false);
    }
  };

  // ── Section 5: manual job trigger ────────────────────────────────────────────
  const triggerJob = async (jobId) => {
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

  return (
    <main style={{ background: C.bg, color: C.text, minHeight: "100vh", padding: "32px 24px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Admin Command Center</h1>
          <button onClick={() => { loadStatus(); loadDevs(); loadJobs(); }} style={btn(C.border)}>
            Refresh all
          </button>
        </header>

        {notice && (
          <div style={{ ...panel, borderColor: C.accent, color: C.accent, padding: "10px 16px", marginBottom: 16 }}>
            {notice}
          </div>
        )}

        {/* 1 — KPI bar */}
        <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
          <Kpi
            label="Settlement mode"
            value={status ? (status.dryRun ? "DRY_RUN" : "LIVE") : statusErr ? "—" : "…"}
            color={status ? (status.dryRun ? C.warn : C.danger) : C.dim}
          />
          <Kpi
            label="Signer balance (POL)"
            value={status ? (status.signerBalance == null ? "No data yet" : Number(status.signerBalance).toFixed(4)) : statusErr ? "—" : "…"}
          />
          <Kpi
            label="Anchor threshold (USDT)"
            value={status ? (status.threshold ?? "No data yet") : statusErr ? "—" : "…"}
          />
        </section>
        {statusErr && <ErrLine msg={`Could not load settlement status: ${statusErr}`} />}

        {/* 4 — Settlement control */}
        <section style={panel}>
          <SectionTitle>Settlement control</SectionTitle>
          {!status && !statusErr && <Muted>Loading…</Muted>}
          {status && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <span style={{ color: C.dim }}>
                Currently:{" "}
                <strong style={{ color: status.dryRun ? C.warn : C.danger }}>
                  {status.dryRun ? "DRY_RUN (simulated)" : "LIVE (real settlements)"}
                </strong>
              </span>
              <button
                onClick={toggleDryRun}
                disabled={busy.dryRun}
                style={btn(status.dryRun ? C.danger : C.accent)}
              >
                {busy.dryRun ? "Working…" : status.dryRun ? "Enable LIVE settlement" : "Return to DRY_RUN"}
              </button>
              {status.dryRun && <span style={{ color: C.dim, fontSize: 13 }}>(requires typing LIVE to confirm)</span>}
            </div>
          )}
        </section>

        {/* 2 — Developer leads */}
        <section style={panel}>
          <SectionTitle>Developer leads</SectionTitle>
          {devs === null && !devErr && <Muted>Loading…</Muted>}
          {devErr && <ErrLine msg={`Could not load developer leads: ${devErr}`} />}
          {devs && devs.length === 0 && !devErr && <Muted>No data yet</Muted>}
          {devs && devs.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: C.dim }}>
                    {["IP", "Classification", "Score", "Days", "Calls/day", "Status", "ISP / Country"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devs.map((d) => (
                    <tr key={d.ip} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={td}>{d.ip}</td>
                      <td style={td}>{d.classification}</td>
                      <td style={td}>{d.score}</td>
                      <td style={td}>{d.days_active}</td>
                      <td style={td}>{d.avg_daily_calls}</td>
                      <td style={td}>{d.status}</td>
                      <td style={td}>{[d.isp, d.country].filter(Boolean).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 3 — Outreach */}
        <section style={panel}>
          <SectionTitle>Outreach</SectionTitle>
          <Muted>Post a Discord outreach template via the configured webhook.</Muted>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => postOutreach(t.id)}
                disabled={busy[`outreach:${t.id}`]}
                style={btn(C.accent)}
              >
                {busy[`outreach:${t.id}`] ? "Sending…" : `Post: ${t.label}`}
              </button>
            ))}
          </div>
        </section>

        {/* 5 — Jobs status */}
        <section style={panel}>
          <SectionTitle>Jobs</SectionTitle>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            {TRIGGERABLE_JOBS.map((j) => (
              <button key={j} onClick={() => triggerJob(j)} disabled={busy[`job:${j}`]} style={btn(C.border)}>
                {busy[`job:${j}`] ? "Running…" : `Trigger ${j}`}
              </button>
            ))}
          </div>
          {jobs === null && !jobsErr && <Muted>Loading…</Muted>}
          {jobsErr && <ErrLine msg={`Could not load jobs: ${jobsErr}`} />}
          {jobs && jobs.length === 0 && !jobsErr && <Muted>No data yet</Muted>}
          {jobs && jobs.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: C.dim }}>
                    {["Job", "Last action", "When"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j, i) => (
                    <tr key={`${j.job_name}-${i}`} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={td}>{j.job_name}</td>
                      <td style={td}>{j.action || "—"}</td>
                      <td style={td}>{j.created_at ? new Date(j.created_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
      <div style={{ color: C.dim, fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || C.text }}>{value}</div>
    </div>
  );
}

const SectionTitle = ({ children }) => (
  <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>{children}</h2>
);
const Muted = ({ children }) => <p style={{ color: C.dim, margin: 0 }}>{children}</p>;
const ErrLine = ({ msg }) => <p style={{ color: C.danger, margin: "6px 0 0", fontSize: 13 }}>{msg}</p>;

const th = { padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", whiteSpace: "nowrap" };
const btn = (border) => ({
  background: "transparent",
  color: C.text,
  border: `1px solid ${border}`,
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 14,
  cursor: "pointer",
});
