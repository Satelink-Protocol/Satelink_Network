"use client";
// MachinePaysDemo (P1 §2.3) — the hero product demo. A scripted, auto-playing
// terminal animation of a machine paying for a call with no human:
//   request → 402 price → pay (x402) → 200 + streamed JSON → verifiable receipt.
// ~12s loop. Pauses when offscreen (IntersectionObserver). Under
// prefers-reduced-motion it renders the final, complete frame with no motion.
// No video file; pure DOM, tiny JS.
import * as React from "react";

type Line = { dir: "req" | "res" | "ok" | "receipt" | "body"; text: string };

const SCRIPT: Line[] = [
  { dir: "req", text: "GET /v1/intelligence/funding-rate-heatmap" },
  { dir: "res", text: "402 Payment Required  { price: 0.01, asset: USDC, network: base }" },
  { dir: "req", text: "X-Payment: x402  amount=0.01 asset=USDC payTo=0x966E…7Ad4" },
  { dir: "ok", text: "200 OK" },
  { dir: "body", text: '{ "metric": "funding-rate-heatmap", "venues": 7, "divergence_bps": 42 }' },
  { dir: "receipt", text: "receipt 0x9b9d…8f21 · verifiable on Polygon" },
];

const STEP_MS = 1900; // ~11.4s for 6 lines, then a hold before looping

const DIR_META: Record<Line["dir"], { mark: string; color: string }> = {
  req: { mark: "→", color: "var(--sl-machine)" },
  res: { mark: "←", color: "var(--sl-market)" },
  ok: { mark: "←", color: "var(--sl-up)" },
  body: { mark: " ", color: "var(--sl-text)" },
  receipt: { mark: "✓", color: "var(--sl-settle)" },
};

export function MachinePaysDemo({ className }: { className?: string }) {
  // Deterministic initial state (0) so SSR and the client's first render match;
  // reduced-motion is resolved in the effect, after hydration.
  const [visibleCount, setVisibleCount] = React.useState(0);
  const [prefersReduced, setPrefersReduced] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const activeRef = React.useRef(true);

  React.useEffect(() => {
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPrefersReduced(true);
      setVisibleCount(SCRIPT.length);
      return;
    }
    const el = ref.current;
    let io: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        ([e]) => {
          activeRef.current = e.isIntersecting;
        },
        { threshold: 0.2 }
      );
      io.observe(el);
    }
    const id = window.setInterval(() => {
      if (!activeRef.current) return;
      setVisibleCount((c) => (c >= SCRIPT.length ? 0 : c + 1));
    }, STEP_MS);
    return () => {
      window.clearInterval(id);
      io?.disconnect();
    };
    // Runs once on mount; reduced-motion is resolved inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      role="img"
      aria-label="A machine paying for a call with no human: it requests a metric, receives an HTTP 402 price, pays via x402, and gets the data back with a verifiable on-chain receipt."
      style={{
        borderRadius: "var(--sl-radius-lg)",
        border: "1px solid var(--sl-border)",
        background: "var(--sl-surface)",
        boxShadow: "var(--sl-shadow-2)",
        overflow: "hidden",
        fontFamily: "var(--sl-font-mono)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--sl-border)",
          background: "var(--sl-bg-raised)",
        }}
        aria-hidden
      >
        <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--sl-down)", display: "inline-block" }} />
        <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--sl-warn)", display: "inline-block" }} />
        <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--sl-up)", display: "inline-block" }} />
        <span style={{ marginLeft: 6, fontSize: 11, color: "var(--sl-text-subtle)" }}>agent → rpc.satelink.network</span>
      </div>
      <div style={{ padding: "16px 18px", minHeight: 210, fontSize: 12.5, lineHeight: 1.9 }} aria-hidden>
        {SCRIPT.map((line, i) => {
          const shown = i < visibleCount;
          const meta = DIR_META[line.dir];
          return (
            <div
              key={i}
              style={{
                opacity: shown ? 1 : 0,
                transform: shown ? "translateY(0)" : "translateY(4px)",
                transition: prefersReduced ? undefined : "opacity .3s ease, transform .3s ease",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              <span style={{ color: meta.color, fontWeight: 700, marginRight: 8 }}>{meta.mark}</span>
              <span style={{ color: line.dir === "body" ? "var(--sl-text-muted)" : "var(--sl-text)" }}>{line.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
