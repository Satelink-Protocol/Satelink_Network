// Machine-commerce lifecycle ring (P1 §2.3) — the 9 steps of how software
// discovers, pays for, and settles a machine-native service, arranged on a
// ring with an animated traversal dot. SSR-complete SVG, accessible via
// <title>/<desc>. The traversal animation is pure CSS and is disabled under
// prefers-reduced-motion (the ring is fully legible static).
import * as React from "react";

type RingStep = { key: string; rail: "machine" | "accent" | "market" | "settle" };

const STEPS: RingStep[] = [
  { key: "DISCOVER", rail: "machine" },
  { key: "IDENTIFY", rail: "machine" },
  { key: "REQUEST", rail: "accent" },
  { key: "PRICE", rail: "accent" },
  { key: "PAY", rail: "accent" },
  { key: "EXECUTE", rail: "market" },
  { key: "METER", rail: "market" },
  { key: "SETTLE", rail: "settle" },
  { key: "RECEIPT", rail: "settle" },
];

const RAIL_VAR: Record<RingStep["rail"], string> = {
  machine: "var(--sl-machine)",
  accent: "var(--sl-accent)",
  market: "var(--sl-market)",
  settle: "var(--sl-settle)",
};

export function LifecycleRing({ className, size = 420 }: { className?: string; size?: number }) {
  const cx = 210;
  const cy = 210;
  const r = 155;
  const nodes = STEPS.map((s, i) => {
    const theta = ((-90 + i * (360 / STEPS.length)) * Math.PI) / 180;
    return { ...s, x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
  });

  return (
    <svg
      viewBox="0 0 420 420"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-labelledby="lifecycle-ring-title lifecycle-ring-desc"
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <title id="lifecycle-ring-title">The machine-commerce lifecycle</title>
      <desc id="lifecycle-ring-desc">
        Nine steps arranged on a ring: discover, identify, request, price, pay, execute, meter, settle,
        receipt — the full path a machine follows to buy and pay for a service.
      </desc>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .lr-rotor { animation: lr-spin 27s linear infinite; transform-origin: 210px 210px; }
        }
        @keyframes lr-spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* base ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--sl-border)" strokeWidth={2} />

      {/* traversal dot (rotates around the ring) */}
      <g className="lr-rotor">
        <circle cx={cx} cy={cy - r} r={7} fill="var(--sl-accent)" />
        <circle cx={cx} cy={cy - r} r={13} fill="var(--sl-accent-soft)" />
      </g>

      {/* nodes */}
      {nodes.map((n, i) => (
        <g key={n.key}>
          <circle cx={n.x} cy={n.y} r={20} fill="var(--sl-surface)" stroke={RAIL_VAR[n.rail]} strokeWidth={2} />
          <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--sl-text)">
            {i + 1}
          </text>
          <text
            x={n.x}
            y={n.y + (n.y < cy ? -28 : 36)}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill="var(--sl-text-muted)"
            style={{ fontFamily: "var(--sl-font-mono)" }}
          >
            {n.key}
          </text>
        </g>
      ))}

      {/* center label */}
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={16} fontWeight={800} fill="var(--sl-text)"
        style={{ fontFamily: "var(--sl-font-display)" }}>
        Machine
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={16} fontWeight={800} fill="var(--sl-text)"
        style={{ fontFamily: "var(--sl-font-display)" }}>
        commerce
      </text>
    </svg>
  );
}
