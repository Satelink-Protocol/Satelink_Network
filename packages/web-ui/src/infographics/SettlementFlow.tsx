// Settlement flow (P1 §2.3) — metered revenue aggregates per epoch and settles
// on-chain to RevenueVault V2 on Polygon, then splits 50/30/20 to node
// operators, the platform, and the distribution pool. SSR-complete, accessible
// SVG. The vault address and split are the real ones (CLAUDE.md 2026-07-16).
import * as React from "react";

const VAULT = "0x577D…BaCEF"; // RevenueVaultV2, Polygon 137

export function SettlementFlow({ className, size = 700 }: { className?: string; size?: number }) {
  const settle = "var(--sl-settle)";
  const splits = [
    { label: "Node operators", pct: "50%", y: 60, rail: "var(--sl-machine)" },
    { label: "Platform", pct: "30%", y: 140, rail: "var(--sl-accent)" },
    { label: "Distribution pool", pct: "20%", y: 220, rail: "var(--sl-market)" },
  ];
  return (
    <svg
      viewBox="0 0 700 300"
      width={size}
      height={(size * 300) / 700}
      className={className}
      role="img"
      aria-labelledby="settle-title settle-desc"
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <title id="settle-title">On-chain settlement flow</title>
      <desc id="settle-desc">
        Metered revenue is aggregated per epoch and settled on-chain to RevenueVault V2 on Polygon, then
        split fifty percent to node operators, thirty to the platform, and twenty to the distribution pool.
      </desc>
      <defs>
        <marker id="settle-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 10 5 0 10Z" fill="var(--sl-text-muted)" />
        </marker>
      </defs>

      {/* metered calls → epoch */}
      <rect x={20} y={120} width={120} height={56} rx={9} fill="var(--sl-surface)" stroke="var(--sl-accent)" strokeWidth={2} />
      <text x={80} y={144} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--sl-text)">Metered calls</text>
      <text x={80} y={160} textAnchor="middle" fontSize={9.5} fill="var(--sl-text-muted)" style={{ fontFamily: "var(--sl-font-mono)" }}>per call</text>

      <rect x={185} y={120} width={130} height={56} rx={9} fill="var(--sl-surface)" stroke={settle} strokeWidth={2} />
      <text x={250} y={144} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--sl-text)">Epoch aggregate</text>
      <text x={250} y={160} textAnchor="middle" fontSize={9.5} fill="var(--sl-text-muted)" style={{ fontFamily: "var(--sl-font-mono)" }}>~every 10 min</text>

      {/* vault */}
      <rect x={360} y={112} width={150} height={72} rx={10} fill="var(--sl-settle-soft)" stroke={settle} strokeWidth={2} />
      <text x={435} y={138} textAnchor="middle" fontSize={12} fontWeight={800} fill="var(--sl-text)" style={{ fontFamily: "var(--sl-font-display)" }}>RevenueVault V2</text>
      <text x={435} y={155} textAnchor="middle" fontSize={9.5} fill="var(--sl-text-muted)" style={{ fontFamily: "var(--sl-font-mono)" }}>{VAULT}</text>
      <text x={435} y={170} textAnchor="middle" fontSize={9.5} fill="var(--sl-text-muted)" style={{ fontFamily: "var(--sl-font-mono)" }}>Polygon · 137</text>

      <line x1={140} y1={148} x2={185} y2={148} stroke="var(--sl-text-muted)" strokeWidth={1.6} markerEnd="url(#settle-arrow)" />
      <line x1={315} y1={148} x2={360} y2={148} stroke="var(--sl-text-muted)" strokeWidth={1.6} markerEnd="url(#settle-arrow)" />

      {/* splits */}
      {splits.map((s) => (
        <g key={s.label}>
          <path d={`M510 148 C 560 148, 560 ${s.y + 20}, 570 ${s.y + 20}`} fill="none" stroke="var(--sl-text-muted)" strokeWidth={1.6} markerEnd="url(#settle-arrow)" />
          <rect x={570} y={s.y} width={120} height={40} rx={8} fill="var(--sl-surface)" stroke={s.rail} strokeWidth={2} />
          <text x={585} y={s.y + 25} fontSize={11} fontWeight={700} fill="var(--sl-text)">{s.label}</text>
          <text x={678} y={s.y + 25} textAnchor="end" fontSize={12} fontWeight={800} fill={s.rail}>{s.pct}</text>
        </g>
      ))}
    </svg>
  );
}
