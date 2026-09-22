// Two-rails diagram (P1 §2.3) — the payments boundary made visual.
//   Rail A (fiat):   card / UPI → Dodo (Merchant of Record) → Dodo-funded
//                    credits → Trading Intelligence ONLY.
//   Rail B (crypto): wallet → x402 / USDT (not billed through Dodo) →
//                    crypto-funded credits → RPC + all machine endpoints.
// The boundary is the load-bearing truth: Dodo money never spends the crypto
// rail and vice-versa. SSR-complete, accessible SVG.
import * as React from "react";

function Node({ x, y, w, label, sub, rail }: { x: number; y: number; w: number; label: string; sub?: string; rail: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={44} rx={9} fill="var(--sl-surface)" stroke={rail} strokeWidth={2} />
      <text x={x + w / 2} y={y + (sub ? 20 : 27)} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--sl-text)">
        {label}
      </text>
      {sub ? (
        <text x={x + w / 2} y={y + 34} textAnchor="middle" fontSize={9.5} fill="var(--sl-text-muted)" style={{ fontFamily: "var(--sl-font-mono)" }}>
          {sub}
        </text>
      ) : null}
    </g>
  );
}

export function TwoRailsDiagram({ className, size = 700 }: { className?: string; size?: number }) {
  const fiat = "var(--sl-market)";
  const crypto = "var(--sl-machine)";
  return (
    <svg
      viewBox="0 0 700 340"
      width={size}
      height={(size * 340) / 700}
      className={className}
      role="img"
      aria-labelledby="rails-title rails-desc"
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <title id="rails-title">The two payment rails and the boundary between them</title>
      <desc id="rails-desc">
        A fiat rail (card or UPI through Dodo, the Merchant of Record) funds credits that can only be spent
        on Trading Intelligence. A separate crypto rail (x402 or USDT, not billed through Dodo) funds credits
        spent on RPC and all machine endpoints. The two balances never cross.
      </desc>
      <defs>
        <marker id="rail-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 10 5 0 10Z" fill="var(--sl-text-muted)" />
        </marker>
      </defs>

      {/* Rail A — fiat / Dodo */}
      <text x={20} y={40} fontSize={12} fontWeight={800} fill={fiat} style={{ fontFamily: "var(--sl-font-display)" }}>
        Fiat rail
      </text>
      <Node x={20} y={52} w={120} label="Card / UPI" rail={fiat} />
      <Node x={190} y={52} w={130} label="Dodo Payments" sub="merchant of record" rail={fiat} />
      <Node x={370} y={52} w={130} label="Credits" sub="Dodo bucket" rail={fiat} />
      <Node x={550} y={52} w={130} label="Trading Intel." sub="ONLY" rail={fiat} />
      {[[140, 190], [320, 370], [500, 550]].map(([x1, x2], i) => (
        <line key={i} x1={x1} y1={74} x2={x2} y2={74} stroke="var(--sl-text-muted)" strokeWidth={1.6} markerEnd="url(#rail-arrow)" />
      ))}

      {/* boundary */}
      <line x1={20} y1={170} x2={680} y2={170} stroke="var(--sl-border-strong)" strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={350} y={162} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sl-text-subtle)" style={{ fontFamily: "var(--sl-font-mono)" }}>
        payments boundary — balances never cross
      </text>

      {/* Rail B — crypto */}
      <text x={20} y={210} fontSize={12} fontWeight={800} fill={crypto} style={{ fontFamily: "var(--sl-font-display)" }}>
        Crypto rail — not billed through Dodo
      </text>
      <Node x={20} y={222} w={120} label="Wallet" rail={crypto} />
      <Node x={190} y={222} w={130} label="x402 / USDT" sub="on-chain" rail={crypto} />
      <Node x={370} y={222} w={130} label="Credits" sub="crypto bucket" rail={crypto} />
      <Node x={550} y={222} w={130} label="RPC + machine" sub="all endpoints" rail={crypto} />
      {[[140, 190], [320, 370], [500, 550]].map(([x1, x2], i) => (
        <line key={i} x1={x1} y1={244} x2={x2} y2={244} stroke="var(--sl-text-muted)" strokeWidth={1.6} markerEnd="url(#rail-arrow)" />
      ))}
    </svg>
  );
}
