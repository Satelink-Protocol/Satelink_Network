"use client";
// MachinePaysDemo (P1 §2.3, upgraded 2026-09-24) — the hero product demo. A
// scripted terminal sequence of a machine paying for an RPC call with no human,
// mirroring the LIVE x402 v2 exchange on rpc.satelink.network/rpc/polygon:
//   request → 402 (0.10 USDC on Base = 1,000 calls) → signed payment → 200 +
//   JSON-RPC result → settlement reference in PAYMENT-RESPONSE.
// Values that vary per call (block number, tx hash) are elided with "…" — the
// demo never shows an invented hash or number. A stage track shows where the
// exchange is; a pause control satisfies WCAG 2.2.2. Pauses offscreen. Under
// prefers-reduced-motion it renders the complete final frame, no motion.
import * as React from "react";

type Line = { dir: "req" | "res" | "ok" | "receipt" | "body"; text: string; stage: number };

const STAGES = ["Request", "402 price", "Pay", "Response", "Receipt"] as const;

const SCRIPT: Line[] = [
  { dir: "req", stage: 0, text: 'POST /rpc/polygon  {"method":"eth_blockNumber"}' },
  { dir: "res", stage: 1, text: "402 Payment Required  x402 v2 · exact · 0.10 USDC · Base (eip155:8453) · 1,000 calls" },
  { dir: "req", stage: 2, text: "PAYMENT-SIGNATURE: signed USDC transfer → payTo 0x966E…7Ad4" },
  { dir: "ok", stage: 3, text: "200 OK" },
  { dir: "body", stage: 3, text: '{ "jsonrpc": "2.0", "id": 1, "result": "0x…" }' },
  { dir: "receipt", stage: 4, text: "PAYMENT-RESPONSE: settled on Base · tx hash returned to the agent" },
];

const STEP_MS = 1900;

const DIR_META: Record<Line["dir"], { mark: string; color: string }> = {
  req: { mark: "→", color: "var(--sl-machine)" },
  res: { mark: "←", color: "var(--sl-market)" },
  ok: { mark: "←", color: "var(--sl-up)" },
  body: { mark: " ", color: "var(--sl-text)" },
  receipt: { mark: "✓", color: "var(--sl-settle)" },
};

export function MachinePaysDemo({ className }: { className?: string }) {
  // Deterministic initial state so SSR and the first client render match.
  // Starts on the first line (the request), never an empty frame
  // (AUDIT_2026-09-25 D15); the loop restarts at 1 for the same reason.
  const [visibleCount, setVisibleCount] = React.useState(1);
  const [prefersReduced, setPrefersReduced] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const onscreenRef = React.useRef(true);
  const pausedRef = React.useRef(false);
  pausedRef.current = paused;

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
      io = new IntersectionObserver(([e]) => {
        onscreenRef.current = e.isIntersecting;
      }, { threshold: 0.2 });
      io.observe(el);
    }
    const id = window.setInterval(() => {
      if (!onscreenRef.current || pausedRef.current) return;
      setVisibleCount((c) => (c >= SCRIPT.length + 1 ? 1 : c + 1)); // +1 = hold on the full frame
    }, STEP_MS);
    return () => {
      window.clearInterval(id);
      io?.disconnect();
    };
  }, []);

  const shownCount = Math.min(visibleCount, SCRIPT.length);
  const activeStage = shownCount === 0 ? -1 : SCRIPT[shownCount - 1].stage;

  return (
    <figure
      ref={ref}
      className={className}
      style={{
        margin: 0,
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
      >
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: 999, background: "var(--sl-down)", display: "inline-block" }} />
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: 999, background: "var(--sl-warn)", display: "inline-block" }} />
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: 999, background: "var(--sl-up)", display: "inline-block" }} />
        <span style={{ marginLeft: 6, fontSize: 11, color: "var(--sl-text-subtle)" }}>agent → rpc.satelink.network</span>
        {!prefersReduced && (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            aria-label={paused ? "Play the payment demo" : "Pause the payment demo"}
            style={{
              marginLeft: "auto",
              fontSize: 11,
              fontFamily: "inherit",
              color: "var(--sl-text-muted)",
              background: "transparent",
              border: "1px solid var(--sl-border)",
              borderRadius: 6,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            {paused ? "▶ Play" : "❚❚ Pause"}
          </button>
        )}
      </div>

      <ol
        aria-label="Payment stages"
        style={{ display: "flex", gap: 4, listStyle: "none", margin: 0, padding: "10px 14px 0", fontSize: 10.5, fontFamily: "var(--sl-font-sans, inherit)" }}
      >
        {STAGES.map((s, i) => {
          const done = i < activeStage;
          const active = i === activeStage;
          return (
            <li
              key={s}
              aria-current={active ? "step" : undefined}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                paddingTop: 6,
                borderTop: `2px solid ${active || done ? "var(--sl-accent)" : "var(--sl-border)"}`,
                color: active ? "var(--sl-text)" : "var(--sl-text-subtle)",
                fontWeight: active ? 700 : 500,
                transition: prefersReduced ? undefined : "border-color .3s, color .3s",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s}
            </li>
          );
        })}
      </ol>

      <div
        role="img"
        aria-label="A machine paying for an RPC call with no human: it sends a JSON-RPC request, receives an HTTP 402 asking for 0.10 USDC on Base for 1,000 calls, sends a signed x402 payment, and gets the JSON-RPC result back with a settlement reference."
        style={{ padding: "12px 18px 16px", minHeight: 220, fontSize: 12.5, lineHeight: 1.9 }}
      >
        {SCRIPT.map((line, i) => {
          const shown = i < shownCount;
          const meta = DIR_META[line.dir];
          return (
            <div
              key={i}
              aria-hidden
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
      <figcaption
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--sl-border)",
          fontSize: 11,
          color: "var(--sl-text-subtle)",
          fontFamily: "var(--sl-font-sans, inherit)",
        }}
      >
        Illustrative replay of the live x402 exchange. Per-call values (block number, tx hash) are elided.
      </figcaption>
    </figure>
  );
}
