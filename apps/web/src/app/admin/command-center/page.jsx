"use client";

/**
 * SATELINK INFRASTRUCTURE COMMAND CENTER — v2 (Tier A)
 * NOC · Intelligence · War Room · Treasury · Security · Operations
 *
 * HONESTY CONTRACT (do not break):
 *   1. Every displayed value comes from a real /admin/* API call, or shows an
 *      explicit "—" / <NoBackendYet>. No hardcoded metric constants, no random
 *      generators, no jitter().
 *   2. Every operator control makes a real API call and confirms success or
 *      surfaces an error. React state is updated only AFTER the API responds.
 *   3. There is no fabricated settled-tx count. totalSettlements is whatever the
 *      API returns (currently 0).
 *
 * All calls go through the server-side proxy at /api/admin-proxy, which injects
 * x-admin-token server-side. No NEXT_PUBLIC_* tokens, nothing secret in browser.
 *
 * The NOC topology SVG is decorative architecture art ("Network Architecture"),
 * not a data display — it carries no numeric metrics.
 */

import { useState, useEffect, useCallback } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

// ─── Design System ────────────────────────────────────────────────────────────
const C = {
  bg: "#050816",
  p1: "#0E1628",
  p2: "#121C33",
  p3: "#0A1422",
  border: "#1A2F50",
  teal: "#5EEAD4",
  ice: "#7DD3FC",
  green: "#34D399",
  warn: "#F59E0B",
  red: "#EF4444",
  text: "#E5EEF8",
  muted: "#94A3B8",
  dim: "rgba(94,234,212,0.06)",
};

// Geist only. UI/labels/tables → Sans. Metrics/logs/data → Mono.
const FONT = { ui: GeistSans.style.fontFamily, mono: GeistMono.style.fontFamily };

// ─── API ──────────────────────────────────────────────────────────────────────
// adminFetch('/intel/developers')                            -> GET  /admin/intel/developers
// adminFetch('/jobs/trigger/ip-classifier', {method:'POST'}) -> POST /admin/jobs/trigger/ip-classifier
async function adminFetch(path, opts = {}) {
  const res = await fetch("/api/admin-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, method: opts.method || "GET", body: opts.body }),
  });
  return res.json();
}

// ─── Formatting (real values only; null/undefined → "—") ────────────────────────
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

const TEMPLATES = [
  { id: "erpc-provider", label: "erpc provider intro" },
  { id: "followup-72h", label: "72h follow-up" },
];
const TRIGGERABLE_JOBS = ["ip-classifier", "customer-zero", "outreach"];
const NEXT_STAGE = { identified: "contacted", contacted: "deposited", deposited: "paid" };
const STAGE_BTN = { contacted: "Mark Contacted", deposited: "Mark Deposited", paid: "Mark Paid" };
const STAGE_COLOR = { identified: C.ice, contacted: C.warn, deposited: C.teal, paid: C.green };

// ─── Atoms ──────────────────────────────────────────────────────────────────────
const Pulse = ({ color = C.green, size = 8 }) => (
  <span style={{ position: "relative", display: "inline-block", width: size, height: size }}>
    <span
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 ${size * 1.5}px ${color}`,
        animation: "pulse 2s ease-in-out infinite",
      }}
    />
  </span>
);

const Badge = ({ label, color = C.teal }) => (
  <span
    style={{
      padding: "2px 7px",
      fontSize: 9,
      fontFamily: FONT.mono,
      letterSpacing: 1,
      background: `${color}18`,
      border: `1px solid ${color}40`,
      color,
      whiteSpace: "nowrap",
    }}
  >
    {String(label).toUpperCase()}
  </span>
);

const Panel = ({ children, style }) => (
  <div style={{ background: C.p1, border: `1px solid ${C.border}`, padding: 16, ...style }}>{children}</div>
);

const SectionLabel = ({ children, right }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
    <div style={{ color: C.muted, fontSize: 9, fontFamily: FONT.mono, letterSpacing: 3 }}>
      ── {String(children).toUpperCase()}
    </div>
    {right && <div>{right}</div>}
  </div>
);

const Metric = ({ label, value, sub, color = C.teal, size = 22, alert }) => (
  <div
    style={{
      padding: "12px 14px",
      background: C.p1,
      border: `1px solid ${alert ? C.red : C.border}`,
      borderTop: `2px solid ${alert ? C.red : color}`,
      position: "relative",
    }}
  >
    {alert && <span style={{ position: "absolute", top: 6, right: 8, color: C.red, fontSize: 11 }}>⚠</span>}
    <div style={{ color: C.muted, fontSize: 9, fontFamily: FONT.mono, letterSpacing: 2, marginBottom: 5 }}>{label}</div>
    <div style={{ color, fontSize: size, fontWeight: 700, fontFamily: FONT.mono, lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ color: C.muted, fontSize: 9, fontFamily: FONT.mono, marginTop: 4 }}>{sub}</div>}
  </div>
);

// Consistent placeholder for every view that has no backend yet.
const NoBackendYet = ({ label, note }) => (
  <div
    style={{
      background: C.p1,
      border: `1px dashed ${C.border}`,
      padding: 18,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      minHeight: 96,
      justifyContent: "center",
    }}
  >
    <div style={{ color: C.muted, fontSize: 9, fontFamily: FONT.mono, letterSpacing: 3 }}>
      ── {String(label).toUpperCase()}
    </div>
    <div style={{ color: C.muted, fontSize: 13, fontFamily: FONT.ui, fontWeight: 600 }}>No backend yet</div>
    {note && <div style={{ color: C.muted, fontSize: 10, fontFamily: FONT.mono, opacity: 0.7 }}>{note}</div>}
  </div>
);

const Loading = () => <span style={{ color: C.muted, fontFamily: FONT.mono, fontSize: 11 }}>Loading…</span>;
const Empty = ({ children }) => <span style={{ color: C.muted, fontFamily: FONT.ui, fontSize: 13 }}>{children}</span>;
const ErrLine = ({ msg }) => (
  <p style={{ color: C.red, margin: "6px 0 0", fontSize: 12, fontFamily: FONT.mono }}>{msg}</p>
);

// ─── Decorative topology (architecture art — NO numbers) ────────────────────────
const Topology = () => {
  const W = 680, H = 215;
  const nodes = [
    { id: "clients", x: 340, y: 20, label: "CLIENTS" },
    { id: "gate", x: 340, y: 64, label: "FREE-TIER GATE" },
    { id: "gateway", x: 340, y: 108, label: "RPC GATEWAY", sub: "rpc.satelink.network" },
    { id: "u1", x: 150, y: 160, label: "UPSTREAM" },
    { id: "u2", x: 280, y: 160, label: "UPSTREAM" },
    { id: "u3", x: 400, y: 160, label: "UPSTREAM" },
    { id: "u4", x: 530, y: 160, label: "UPSTREAM" },
    { id: "settle", x: 340, y: 200, label: "BILLING · EPOCH" },
  ];
  const paths = [
    { id: "a", d: "M340,30 L340,54", color: C.teal, dur: "1.4s" },
    { id: "b", d: "M340,74 L340,98", color: C.ice, dur: "1.5s" },
    { id: "g1", d: "M330,118 C250,138 175,144 158,152", color: C.ice, dur: "1.9s" },
    { id: "g2", d: "M336,118 C312,138 286,146 284,152", color: C.ice, dur: "1.7s" },
    { id: "g3", d: "M344,118 C368,138 398,146 400,152", color: C.ice, dur: "1.8s" },
    { id: "g4", d: "M350,118 C440,138 515,144 526,152", color: C.ice, dur: "2.1s" },
    { id: "s1", d: "M158,170 C210,192 300,194 332,194", color: C.green, dur: "2.0s" },
    { id: "s4", d: "M526,170 C470,192 380,194 348,194", color: C.green, dur: "2.0s" },
  ];
  const offsets = ["0%", "33%", "66%"];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      <defs>
        {paths.map((p) => (
          <path key={p.id} id={`tp_${p.id}`} d={p.d} fill="none" />
        ))}
        <filter id="tpGlow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {paths.map((p) => (
        <use key={`l_${p.id}`} href={`#tp_${p.id}`} stroke={p.color} strokeWidth="1" strokeOpacity="0.22" />
      ))}
      {paths.map((p) =>
        offsets.map((_, i) => (
          <circle key={`${p.id}-${i}`} r="2.5" fill={p.color} filter="url(#tpGlow)" opacity="0.9">
            <animateMotion dur={p.dur} repeatCount="indefinite" begin={`${i * parseFloat(p.dur) * 0.33}s`}>
              <mpath href={`#tp_${p.id}`} />
            </animateMotion>
          </circle>
        ))
      )}
      {nodes.map((n) => {
        const accent = n.id === "gateway" ? C.teal : n.id === "settle" ? C.green : C.ice;
        return (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={n.id === "gateway" ? 10 : 8} fill={C.p2} stroke={accent} strokeWidth={n.id === "gateway" ? 2 : 1} />
            <circle cx={n.x} cy={n.y} r={n.id === "gateway" ? 4 : 3} fill={accent} opacity="0.9">
              {n.id === "gateway" && <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />}
            </circle>
            <text x={n.x} y={n.y - 14} textAnchor="middle" style={{ fill: C.text, fontSize: 9, fontFamily: FONT.mono, letterSpacing: 1 }}>
              {n.label}
            </text>
            {n.sub && (
              <text x={n.x} y={n.y + 22} textAnchor="middle" style={{ fill: C.muted, fontSize: 8, fontFamily: FONT.mono }}>
                {n.sub}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

// ─── Live feed (real SSE through the proxy) ─────────────────────────────────────
const LiveFeed = ({ feed, feedState }) => (
  <Panel style={{ overflowY: "auto", maxHeight: 620 }}>
    <SectionLabel
      right={<Pulse color={feedState === "live" ? C.green : feedState === "error" ? C.red : C.warn} />}
    >
      Live Event Stream
    </SectionLabel>
    {feed.length === 0 && feedState !== "error" && (
      <div style={{ color: C.muted, fontFamily: FONT.mono, fontSize: 11 }}>Connecting…</div>
    )}
    {feed.length === 0 && feedState === "error" && (
      <div style={{ color: C.muted, fontFamily: FONT.mono, fontSize: 11 }}>
        Live feed unavailable. It will reconnect automatically.
      </div>
    )}
    <div>
      {feed.map((e, i) => (
        <div
          key={e.id ?? i}
          style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: `1px solid ${C.border}20`, fontFamily: FONT.mono, fontSize: 10 }}
        >
          <span style={{ color: C.muted, minWidth: 64 }}>{fmt.time(e.created_at)}</span>
          <span style={{ color: C.ice, minWidth: 110 }}>[{e.job_name || "log"}]</span>
          <span style={{ color: C.text }}>{e.action || "—"}</span>
        </div>
      ))}
    </div>
  </Panel>
);

// ─── NOC ────────────────────────────────────────────────────────────────────────
const NOCView = ({ status, statusErr, feed, feedState }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Panel>
        <SectionLabel right={<Badge label="DESIGN" color={C.muted} />}>Network Architecture</SectionLabel>
        <Topology />
        <div style={{ color: C.muted, fontSize: 9, fontFamily: FONT.mono, marginTop: 8 }}>
          Structural diagram — not a live data feed.
        </div>
      </Panel>

      {/* Real settlement/status cards (replaces the old jitter()-driven p50/p95/rps) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        <Metric
          label="SETTLEMENT MODE"
          value={status ? (status.dryRun ? "DRY_RUN" : "LIVE") : statusErr ? "—" : "…"}
          color={status ? (status.dryRun ? C.warn : C.red) : C.muted}
          size={18}
          alert={status ? !status.dryRun : false}
        />
        <Metric
          label="SIGNER POL"
          value={status ? fmt.bal(status.signerBalance) : statusErr ? "—" : "…"}
          color={C.ice}
          size={18}
        />
        <Metric
          label="ANCHOR THRESHOLD"
          value={status ? (status.threshold ?? "—") : statusErr ? "—" : "…"}
          sub="USDT"
          color={C.teal}
          size={18}
        />
        <Metric
          label="SETTLED TXs"
          value={status ? fmt.num(status.totalSettlements ?? 0) : statusErr ? "—" : "…"}
          sub="on-chain epochs"
          color={C.green}
          size={18}
        />
      </div>
      {statusErr && <ErrLine msg={`Could not load settlement status: ${statusErr}`} />}

      <NoBackendYet label="RPC Metrics" note="req/sec · p50 · p95 · p99 · error rate — requires telemetry pipeline" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <NoBackendYet label="24h Request Volume" note="Requires time-series store" />
        <NoBackendYet label="Provider Pool Utilization" note="Requires upstream stats endpoint" />
      </div>
    </div>

    <LiveFeed feed={feed} feedState={feedState} />
  </div>
);

// ─── Intelligence (no backend yet) ──────────────────────────────────────────────
const IntelView = () => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
    <div style={{ gridColumn: "1/-1" }}>
      <NoBackendYet label="Provider Intelligence Matrix" note="latency · success% · traffic share — requires upstream telemetry" />
    </div>
    <NoBackendYet label="Traffic by Country" note="Requires geo aggregation endpoint" />
    <NoBackendYet label="Top Sources / ASN / Method" note="Requires aggregation endpoint" />
    <div style={{ gridColumn: "1/-1" }}>
      <NoBackendYet label="Latency Distribution" note="Requires telemetry pipeline" />
    </div>
    <div style={{ gridColumn: "1/-1", color: C.muted, fontFamily: FONT.mono, fontSize: 10 }}>
      Real per-IP classification (developer / machine leads) lives in the War Room view.
    </div>
  </div>
);

// ─── War Room (real: leads, funnel-by-status, stage, outreach, classify) ─────────
const WarRoomView = ({ devs, devErr, busy, advance, outreach, classify }) => {
  const counts = (devs || []).reduce((a, d) => ((a[d.status] = (a[d.status] || 0) + 1), a), {});
  const funnel = [
    { label: "Classified leads", n: devs ? devs.length : null, color: C.muted },
    { label: "Identified", n: devs ? counts.identified || 0 : null, color: C.ice },
    { label: "Contacted", n: devs ? counts.contacted || 0 : null, color: C.warn },
    { label: "Deposited", n: devs ? counts.deposited || 0 : null, color: C.teal },
    { label: "Paid", n: devs ? counts.paid || 0 : null, color: C.green },
  ];
  const maxN = Math.max(1, ...funnel.map((s) => s.n || 0));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel>
          <SectionLabel>Conversion Funnel</SectionLabel>
          {!devs && !devErr && <Loading />}
          {devs &&
            funnel.map((s) => (
              <div key={s.label} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ color: C.text, fontSize: 10, fontFamily: FONT.mono }}>{s.label}</span>
                  <span style={{ color: s.color, fontSize: 10, fontFamily: FONT.mono, fontWeight: 700 }}>{fmt.num(s.n)}</span>
                </div>
                <div style={{ height: 6, background: C.p3 }}>
                  <div style={{ height: "100%", width: `${((s.n || 0) / maxN) * 100}%`, background: s.color, opacity: s.n ? 0.85 : 0.2 }} />
                </div>
              </div>
            ))}
          <div style={{ color: C.muted, fontSize: 9, fontFamily: FONT.mono, marginTop: 8, opacity: 0.8 }}>
            Counts are real, derived from classified leads. Upstream stages (active IPs → free-limit hits) require a
            telemetry pipeline — not shown to avoid estimates.
          </div>
        </Panel>

        <Panel>
          <SectionLabel>IP Classifier</SectionLabel>
          <button onClick={classify} disabled={busy.classify} style={btn(busy.classify ? C.border : C.teal)}>
            {busy.classify ? "Running…" : "Run IP Classifier"}
          </button>
        </Panel>

        <Panel>
          <SectionLabel>Outreach</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {TEMPLATES.map((t) => (
              <button key={t.id} onClick={() => outreach(t.id)} disabled={busy[`outreach:${t.id}`]} style={btn(C.ice)}>
                {busy[`outreach:${t.id}`] ? "Sending…" : `Send: ${t.label}`}
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionLabel right={<Badge label={`${devs ? devs.length : 0} leads`} color={C.ice} />}>Lead Pipeline</SectionLabel>
        {!devs && !devErr && <Loading />}
        {devErr && <ErrLine msg={`Could not load leads: ${devErr}`} />}
        {devs && devs.length === 0 && !devErr && <Empty>No leads classified yet</Empty>}
        {devs && devs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {devs.map((l) => {
              const next = NEXT_STAGE[l.status];
              return (
                <div
                  key={l.ip}
                  style={{
                    padding: "10px 12px",
                    background: C.p2,
                    border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${STAGE_COLOR[l.status] || C.muted}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ color: C.teal, fontSize: 11, fontFamily: FONT.mono, minWidth: 120 }}>{l.ip}</span>
                  <span style={{ color: C.muted, fontSize: 10, fontFamily: FONT.ui, minWidth: 150 }}>
                    {[l.isp, l.country].filter(Boolean).join(" · ") || "—"}
                  </span>
                  <Badge label={l.classification || "unknown"} color={l.classification === "developer" ? C.teal : C.muted} />
                  <div style={{ flex: 1, display: "flex", gap: 16, alignItems: "center", fontFamily: FONT.mono, fontSize: 10 }}>
                    <span style={{ color: C.text }}>{fmt.num(l.avg_daily_calls)}/day</span>
                    <span style={{ color: C.muted }}>{l.days_active ?? 0}d</span>
                    <span style={{ color: C.muted }}>score {l.score ?? 0}</span>
                  </div>
                  <Badge label={l.status} color={STAGE_COLOR[l.status] || C.muted} />
                  {next && (
                    <button
                      onClick={() => advance(l.ip, next)}
                      disabled={busy[`stage:${l.ip}`]}
                      style={btn(STAGE_COLOR[next] || C.ice, true)}
                    >
                      {busy[`stage:${l.ip}`] ? "Saving…" : STAGE_BTN[next]}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
};

// ─── Treasury (real: settlement status + DRY_RUN control) ────────────────────────
const TreasuryView = ({ status, statusErr, busy, toggleDryRun }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 12 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
        <Metric
          label="SETTLEMENT MODE"
          value={status ? (status.dryRun ? "DRY_RUN" : "LIVE") : statusErr ? "—" : "…"}
          sub={status ? (status.dryRun ? "no real TXs" : "real POL spent") : ""}
          color={status ? (status.dryRun ? C.warn : C.red) : C.muted}
          size={18}
          alert={status ? !status.dryRun : false}
        />
        <Metric label="SIGNER POL" value={status ? fmt.bal(status.signerBalance) : statusErr ? "—" : "…"} sub={status?.signerBalance == null ? "no signer / unreachable" : "on-chain"} color={C.ice} size={18} />
        <Metric label="ANCHOR THRESHOLD" value={status ? (status.threshold ?? "—") : statusErr ? "—" : "…"} sub="USDT" color={C.teal} size={18} />
        <Metric label="SETTLED TXs" value={status ? fmt.num(status.totalSettlements ?? 0) : statusErr ? "—" : "…"} sub="on-chain epochs" color={C.green} size={18} />
        <Metric label="SIGNER ADDRESS" value={status ? fmt.addr(status.signerAddress) : "…"} color={C.muted} size={13} />
        <Metric label="TREASURY ADDRESS" value={status ? fmt.addr(status.treasuryAddress) : "…"} color={C.muted} size={13} />
      </div>
      {statusErr && <ErrLine msg={`Could not load settlement status: ${statusErr}`} />}

      <Panel>
        <SectionLabel>Settlement Control</SectionLabel>
        {!status && !statusErr && <Loading />}
        {status && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ color: C.muted, fontFamily: FONT.ui, fontSize: 14 }}>
              Currently:{" "}
              <strong style={{ color: status.dryRun ? C.warn : C.red }}>
                {status.dryRun ? "DRY_RUN (simulated)" : "LIVE (real settlements)"}
              </strong>
            </span>
            <button onClick={toggleDryRun} disabled={busy.dryRun} style={btn(status.dryRun ? C.red : C.teal)}>
              {busy.dryRun ? "Working…" : status.dryRun ? "Enable LIVE settlement" : "Return to DRY_RUN"}
            </button>
            {status.dryRun && (
              <span style={{ color: C.muted, fontSize: 12, fontFamily: FONT.ui }}>(requires typing LIVE to confirm)</span>
            )}
          </div>
        )}
      </Panel>

      <NoBackendYet label="Revenue Velocity" note="metered/day · epochs open — requires billing + epoch endpoints" />
    </div>

    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <NoBackendYet label="Epoch Detail" note="Requires epoch endpoint in admin router" />
      <NoBackendYet label="On-chain Treasury Balance" note="Requires balance read endpoint" />
    </div>
  </div>
);

// ─── Security (no backend yet) ──────────────────────────────────────────────────
const SecurityView = () => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 12 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <NoBackendYet label="SOC Metrics" note="blocked IPs · rate events · gate hits · auth failures — requires security pipeline" />
      <NoBackendYet label="Security Event Feed" note="Requires threat-event store" />
      <NoBackendYet label="Known Threat Patterns" note="Requires detection pipeline" />
    </div>
    <NoBackendYet label="Anomaly Scores" note="Requires anomaly engine" />
  </div>
);

// ─── Operations (real: jobs + triggers; honest empties elsewhere) ────────────────
const OpsView = ({ jobs, jobsErr, busy, trigger }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
    <Panel>
      <SectionLabel>Automation Jobs</SectionLabel>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {TRIGGERABLE_JOBS.map((j) => (
          <button key={j} onClick={() => trigger(j)} disabled={busy[`job:${j}`]} style={btn(C.border)}>
            {busy[`job:${j}`] ? "Running…" : `Trigger ${j}`}
          </button>
        ))}
      </div>
      {!jobs && !jobsErr && <Loading />}
      {jobsErr && <ErrLine msg={`Could not load jobs: ${jobsErr}`} />}
      {jobs && jobs.length === 0 && !jobsErr && <Empty>No jobs have run yet.</Empty>}
      {jobs && jobs.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT.ui, fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: C.muted }}>
              {["Job", "Last action", "When"].map((h) => (
                <th key={h} style={{ padding: "8px 10px", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j, i) => (
              <tr key={`${j.job_name}-${i}`} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 10px", fontFamily: FONT.mono }}>{j.job_name}</td>
                <td style={{ padding: "8px 10px" }}>{j.action || "—"}</td>
                <td style={{ padding: "8px 10px", fontFamily: FONT.mono, color: C.muted }}>{fmt.time(j.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>

    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <NoBackendYet label="Paperclip AI Operations" note="Manage at agents.satelink.network" />
      <NoBackendYet label="Distribution Channels" note="Requires channel-tracking endpoint" />
    </div>
  </div>
);

// ─── Shell ──────────────────────────────────────────────────────────────────────
const NAV = [
  { id: "noc", icon: "◈", label: "NOC" },
  { id: "intel", icon: "◉", label: "Intelligence" },
  { id: "war", icon: "⊕", label: "War Room" },
  { id: "treas", icon: "◎", label: "Treasury" },
  { id: "sec", icon: "⊗", label: "Security" },
  { id: "ops", icon: "◐", label: "Operations" },
];

const btn = (border, small) => ({
  background: "transparent",
  color: border,
  border: `1px solid ${border}`,
  borderRadius: 6,
  padding: small ? "3px 10px" : "8px 14px",
  fontSize: small ? 9 : 13,
  fontFamily: FONT.mono,
  cursor: "pointer",
});

export default function AdminCommandCenter() {
  const [view, setView] = useState("noc");
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
  const [feedState, setFeedState] = useState("connecting"); // connecting | live | error

  const setBusyFor = (k, v) => setBusy((b) => ({ ...b, [k]: v }));
  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 6000);
  };

  // Clock (display only, not a metric)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString("en-US", { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Loaders ────────────────────────────────────────────────────────────────
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

  // ── Real SSE live feed via the proxy (token injected server-side) ────────────
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

  // ── Actions (every one awaits the API before touching React state) ───────────
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
      // `enabled` IS the dryRun value: enabled=false turns LIVE on.
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
      setDevs((ds) => (ds || []).map((d) => (d.ip === ip ? { ...d, status: stage } : d))); // only after 200
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

  const current = NAV.find((n) => n.id === view);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT.ui }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity:0.6; transform:scale(1); } 50% { opacity:1; transform:scale(1.15); } }
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:${C.bg}; }
        ::-webkit-scrollbar-thumb { background:${C.border}; }
        button:hover:not(:disabled) { opacity:0.85; }
        button:disabled { opacity:0.5; cursor:default; }
      `}</style>

      {/* Sidebar */}
      <div
        style={{
          width: 60,
          background: C.p1,
          borderRight: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "12px 0",
          gap: 4,
          flexShrink: 0,
        }}
      >
        <div style={{ color: C.teal, fontSize: 18, marginBottom: 16 }}>◈</div>
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            title={n.label}
            style={{
              width: 44,
              height: 44,
              background: view === n.id ? `${C.teal}15` : "transparent",
              border: `1px solid ${view === n.id ? C.teal + "60" : "transparent"}`,
              color: view === n.id ? C.teal : C.muted,
              fontSize: 16,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
            }}
          >
            <span>{n.icon}</span>
            <span style={{ fontSize: 7, fontFamily: FONT.mono, letterSpacing: 0.5 }}>{n.label.split(" ")[0].slice(0, 3)}</span>
          </button>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top bar — real settlement status only */}
        <div
          style={{
            height: 30,
            background: C.p1,
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            gap: 24,
            flexShrink: 0,
          }}
        >
          <span style={{ color: C.muted, fontSize: 9, fontFamily: FONT.mono, letterSpacing: 3 }}>SATELINK COMMAND CENTER</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ color: C.muted, fontSize: 8, fontFamily: FONT.mono }}>SETTLEMENT</span>
            <span style={{ color: status ? (status.dryRun ? C.warn : C.red) : C.muted, fontSize: 9, fontFamily: FONT.mono, fontWeight: 700 }}>
              {status ? (status.dryRun ? "DRY_RUN" : "LIVE") : "…"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ color: C.muted, fontSize: 8, fontFamily: FONT.mono }}>SETTLED</span>
            <span style={{ color: C.green, fontSize: 9, fontFamily: FONT.mono, fontWeight: 700 }}>
              {status ? fmt.num(status.totalSettlements ?? 0) : "…"}
            </span>
          </div>
          <div style={{ width: 1, height: 14, background: C.border }} />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Pulse color={feedState === "live" ? C.green : feedState === "error" ? C.red : C.warn} />
            <span style={{ color: C.muted, fontSize: 9, fontFamily: FONT.mono }}>{now}</span>
          </div>
        </div>

        {/* Section header */}
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}20`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: C.teal, fontSize: 13, fontFamily: FONT.mono }}>{current?.icon}</span>
          <span style={{ color: C.text, fontSize: 12, fontFamily: FONT.mono, fontWeight: 600, letterSpacing: 2 }}>
            {current?.label.toUpperCase()}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              loadStatus();
              loadDevs();
              loadJobs();
            }}
            style={btn(C.border, true)}
          >
            Refresh all
          </button>
        </div>

        {/* Notice */}
        {notice && (
          <div style={{ margin: "12px 16px 0", padding: "10px 16px", background: C.p1, border: `1px solid ${C.teal}`, color: C.teal, fontFamily: FONT.mono, fontSize: 12 }}>
            {notice}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, padding: 14, overflowY: "auto" }}>
          {view === "noc" && <NOCView status={status} statusErr={statusErr} feed={feed} feedState={feedState} />}
          {view === "intel" && <IntelView />}
          {view === "war" && (
            <WarRoomView devs={devs} devErr={devErr} busy={busy} advance={advance} outreach={outreach} classify={classify} />
          )}
          {view === "treas" && <TreasuryView status={status} statusErr={statusErr} busy={busy} toggleDryRun={toggleDryRun} />}
          {view === "sec" && <SecurityView />}
          {view === "ops" && <OpsView jobs={jobs} jobsErr={jobsErr} busy={busy} trigger={trigger} />}
        </div>
      </div>
    </div>
  );
}
