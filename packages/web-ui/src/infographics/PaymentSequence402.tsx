// HTTP 402 payment sequence (P1 §2.3) — how an agent pays for a call with no
// human, mirroring the live RPC x402 v2 flow: request → 402 → retry with
// PAYMENT-SIGNATURE → facilitator verifies + settles on Base → 200 + PAYMENT-RESPONSE.
// SSR-complete, accessible SVG. Mechanism-accurate (x402 on Base via a
// facilitator, settling on-chain).
import * as React from "react";

const ACTORS = [
  { key: "agent", label: "Agent", x: 80, rail: "var(--sl-machine)" },
  { key: "api", label: "Satelink API", x: 270, rail: "var(--sl-accent)" },
  { key: "facilitator", label: "Facilitator", x: 460, rail: "var(--sl-settle)" },
  { key: "chain", label: "Base chain", x: 620, rail: "var(--sl-settle)" },
];

type Msg = { from: number; to: number; y: number; label: string; dashed?: boolean };
const MSGS: Msg[] = [
  { from: 0, to: 1, y: 110, label: "POST /rpc/polygon" },
  { from: 1, to: 0, y: 148, label: "402 · 0.10 USDC on Base", dashed: true },
  { from: 0, to: 1, y: 186, label: "retry + PAYMENT-SIGNATURE" },
  { from: 1, to: 2, y: 224, label: "verify + settle" },
  { from: 2, to: 3, y: 262, label: "USDC transfer" },
  { from: 2, to: 1, y: 300, label: "settled · tx hash", dashed: true },
  { from: 1, to: 0, y: 338, label: "200 OK + result + PAYMENT-RESPONSE", dashed: true },
];

export function PaymentSequence402({ className, size = 680 }: { className?: string; size?: number }) {
  const top = 66;
  const bottom = 360;
  return (
    <svg
      viewBox="0 0 680 380"
      width={size}
      height={(size * 380) / 680}
      className={className}
      role="img"
      aria-labelledby="seq402-title seq402-desc"
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <title id="seq402-title">The HTTP 402 payment sequence</title>
      <desc id="seq402-desc">
        An agent sends a JSON-RPC request; the API answers 402 Payment Required asking for 0.10 USDC on Base;
        the agent retries with a signed x402 payment; the API has the facilitator verify and settle it on Base,
        then returns the result with the settlement reference in the PAYMENT-RESPONSE header.
      </desc>
      <defs>
        <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10Z" fill="var(--sl-text-muted)" />
        </marker>
      </defs>

      {/* actors + lifelines */}
      {ACTORS.map((a) => (
        <g key={a.key}>
          <rect x={a.x - 52} y={top - 22} width={104} height={30} rx={8} fill="var(--sl-surface)" stroke={a.rail} strokeWidth={2} />
          <text x={a.x} y={top - 2} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--sl-text)">
            {a.label}
          </text>
          <line x1={a.x} y1={top + 10} x2={a.x} y2={bottom} stroke="var(--sl-border)" strokeWidth={1.5} strokeDasharray="2 4" />
        </g>
      ))}

      {/* messages */}
      {MSGS.map((m, i) => {
        const x1 = ACTORS[m.from].x;
        const x2 = ACTORS[m.to].x;
        const dir = x2 > x1 ? 1 : -1;
        return (
          <g key={i}>
            <line
              x1={x1 + dir * 4}
              y1={m.y}
              x2={x2 - dir * 4}
              y2={m.y}
              stroke="var(--sl-text-muted)"
              strokeWidth={1.6}
              strokeDasharray={m.dashed ? "5 4" : undefined}
              markerEnd="url(#seq-arrow)"
            />
            <text
              x={(x1 + x2) / 2}
              y={m.y - 6}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={600}
              fill="var(--sl-text-muted)"
              style={{ fontFamily: "var(--sl-font-mono)" }}
            >
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
