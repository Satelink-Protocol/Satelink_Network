// Balance & metering waterfall (P1 §2.3) — how a prepaid balance is metered:
// a top-up adds credit, each call deducts the per-call rate and issues a
// receipt, and the remaining balance carries forward. SSR-complete, accessible
// SVG. Figures are an illustrative example of the mechanism, not live data.
import * as React from "react";

export function MeteringWaterfall({ className, size = 640 }: { className?: string; size?: number }) {
  const baseY = 250;
  const topUpH = 170; // $10.00 top-up
  const perCall = 14; // visual deduction per metered call
  const calls = 5;
  const cols = [
    { label: "Top-up", sub: "+$10.00", x: 40, kind: "up" as const },
    ...Array.from({ length: calls }, (_, i) => ({
      label: `Call ${i + 1}`,
      sub: "-$0.01",
      x: 160 + i * 78,
      kind: "down" as const,
    })),
    { label: "Balance", sub: "carried", x: 160 + calls * 78, kind: "total" as const },
  ];

  let running = topUpH;
  return (
    <svg
      viewBox="0 0 640 300"
      width={size}
      height={(size * 300) / 640}
      className={className}
      role="img"
      aria-labelledby="meter-title meter-desc"
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <title id="meter-title">Balance metering waterfall</title>
      <desc id="meter-desc">
        A top-up adds credit to a prepaid balance; each call deducts the per-call rate and issues a receipt;
        the remaining balance carries forward. Figures illustrate the mechanism.
      </desc>
      <line x1={20} y1={baseY} x2={620} y2={baseY} stroke="var(--sl-border-strong)" strokeWidth={1.5} />

      {cols.map((c, i) => {
        let y: number;
        let h: number;
        let fill: string;
        let stroke: string;
        if (c.kind === "up") {
          h = topUpH;
          y = baseY - h;
          fill = "var(--sl-market-soft)";
          stroke = "var(--sl-market)";
        } else if (c.kind === "down") {
          h = perCall;
          y = baseY - running;
          running -= perCall;
          fill = "var(--sl-accent-soft)";
          stroke = "var(--sl-accent)";
        } else {
          h = running;
          y = baseY - h;
          fill = "var(--sl-settle-soft)";
          stroke = "var(--sl-settle)";
        }
        return (
          <g key={i}>
            <rect x={c.x} y={y} width={58} height={h} rx={5} fill={fill} stroke={stroke} strokeWidth={2} />
            {c.kind === "down" ? (
              <path d={`M${c.x + 8} ${y - 8} h42 v10 l-6 -4 -6 4 -6 -4 -6 4 -6 -4 -6 4Z`} fill="var(--sl-surface)" stroke="var(--sl-settle)" strokeWidth={1.2} strokeLinejoin="round" />
            ) : null}
            <text x={c.x + 29} y={baseY + 18} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sl-text)">
              {c.label}
            </text>
            <text x={c.x + 29} y={baseY + 32} textAnchor="middle" fontSize={9.5} fill="var(--sl-text-muted)" style={{ fontFamily: "var(--sl-font-mono)" }}>
              {c.sub}
            </text>
          </g>
        );
      })}
      <text x={40} y={28} fontSize={11} fontWeight={600} fill="var(--sl-text-subtle)" style={{ fontFamily: "var(--sl-font-mono)" }}>
        each call ↓ issues a receipt ▦
      </text>
    </svg>
  );
}
