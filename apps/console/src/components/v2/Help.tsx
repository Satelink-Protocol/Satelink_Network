"use client";
// Inline "What's this?" for jargon. Keyboard and touch friendly: a button that
// toggles a short, plain-language definition (no hover-only tooltips).
import { useId, useState } from "react";

export const GLOSSARY: Record<string, string> = {
  x402: "A way for software to pay per request over the web: the server answers “402 Payment Required” with a price, the software pays, then gets the answer. No account needed.",
  UU: "Usage Units — how plan allowances are counted. 1 UU = $0.001 of list price. One market-data request is 10 UU.",
  RPC: "Blockchain RPC — the way software reads the Polygon blockchain (balances, blocks, contracts). Paid per call from crypto credits.",
  "API key": "A secret password your software sends with each request so Satelink knows which account to charge.",
  "crypto credits": "Money added in USDT on Polygon. It pays for RPC and, if you allow it, market data beyond your plan.",
  "session window": "Your plan's short-term allowance. It refills gradually over a rolling 5-hour period.",
  "weekly window": "Your plan's weekly allowance. It resets every Monday in your account's timezone.",
};

export function Help({ term, label }: { term: keyof typeof GLOSSARY | string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = GLOSSARY[term] ?? "";
  return (
    <span className="relative inline-block align-baseline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="ml-1 rounded-full border border-sl-border px-1.5 text-[11px] leading-5 text-sl-text-muted hover:text-sl-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45"
      >
        {label ?? `What's ${term}?`}
      </button>
      {open && (
        <span id={id} role="note" className="absolute left-0 top-7 z-40 block w-72 rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-3 text-[13px] leading-snug text-sl-text shadow-[var(--sl-shadow-3)]">
          {text}
        </span>
      )}
    </span>
  );
}
