"use client";
// The signature interactive section (§3): DISCOVER → IDENTIFY → REQUEST → PRICE
// → PAY → EXECUTE → METER → SETTLE → RECEIPT. Every step renders its full
// content in the DOM (SSR-complete — no client-only shell); the client layer
// only toggles which panel is visually active. Keyboard-accessible: a roving
// tablist (Arrow/Home/End move, Enter/Space select). Mechanisms are the real
// Satelink ones; the reveal is a real request/response shape.
import * as React from "react";

export type LifecycleStep = {
  key: string;
  plain: string;
  mechanism: string;
  reveal: string; // code/JSON
};

export const DEFAULT_LIFECYCLE: LifecycleStep[] = [
  { key: "DISCOVER", plain: "A machine finds a service it can buy.", mechanism: "Discovery via /.well-known/satelink.json and the /v1/intelligence catalog.", reveal: `GET https://rpc.satelink.network/.well-known/satelink.json\n{\n  "services": ["/v1/intelligence", "/rpc/polygon"],\n  "pricing": "https://satelink.network/pricing.json"\n}` },
  { key: "IDENTIFY", plain: "It presents who it is.", mechanism: "An API key, or a wallet for the keyless x402 rail.", reveal: `Authorization: Bearer <your-api-key>\n# or, keyless:\nX-Payment: x402 <signed-authorization>` },
  { key: "REQUEST", plain: "It calls the endpoint.", mechanism: "A normal HTTPS request to the product endpoint.", reveal: `curl https://rpc.satelink.network/v1/intelligence/funding-rate-heatmap` },
  { key: "PRICE", plain: "The service quotes a price the machine can read.", mechanism: "HTTP 402 Payment Required with machine-readable requirements.", reveal: `HTTP/1.1 402 Payment Required\n{\n  "accepts": [{ "scheme": "x402", "network": "eip155:8453",\n    "maxAmountRequired": "0.01", "asset": "USDC" }]\n}` },
  { key: "PAY", plain: "The machine pays — no human, no checkout.", mechanism: "x402 (USDC on Base), a USDT deposit, or a prepaid credit balance.", reveal: `X-Payment: x402 network=eip155:8453 amount=0.01 asset=USDC\n  payTo=0x966E…7Ad4 signature=…` },
  { key: "EXECUTE", plain: "The service runs the work.", mechanism: "The gateway executes the RPC / intelligence query.", reveal: `HTTP/1.1 200 OK\n{ "metric": "funding-rate-heatmap", "data": [ … ] }` },
  { key: "METER", plain: "Usage is counted.", mechanism: "Per-call metering deducts from the balance at the flat rate.", reveal: `{ "call": "funding-rate-heatmap", "unit": "call", "charged": 0.00003 }` },
  { key: "SETTLE", plain: "Revenue settles on-chain.", mechanism: "Per-epoch aggregation to RevenueVault on Polygon (137).", reveal: `RevenueVault 0x577D…BaCEF  (Polygon)\nepoch=… gross=… split=50/30/20` },
  { key: "RECEIPT", plain: "A verifiable receipt is issued.", mechanism: "A settlement reference the payer can verify on-chain.", reveal: `{ "epoch": …, "txHash": "0x…", "verify": "polygonscan.com/tx/0x…" }` },
];

export function LifecycleStepper({ steps = DEFAULT_LIFECYCLE, id = "lifecycle" }: { steps?: LifecycleStep[]; id?: string }) {
  const [active, setActive] = React.useState(0);
  const tabsRef = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % steps.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + steps.length) % steps.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = steps.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
    tabsRef.current[next]?.focus();
  };

  return (
    <div id={id} className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
      <div
        role="tablist"
        aria-label="How a machine pays"
        aria-orientation="horizontal"
        className="flex flex-wrap gap-1.5 border-b border-sl-border pb-4"
      >
        {steps.map((s, i) => (
          <button
            key={s.key}
            ref={(el) => { tabsRef.current[i] = el; }}
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className="rounded-[var(--sl-radius-sm)] px-2.5 py-1.5 font-sl-mono text-xs font-medium tracking-wide text-sl-text-subtle transition-colors hover:text-sl-text aria-selected:bg-sl-accent aria-selected:text-sl-accent-ink"
          >
            {i + 1}. {s.key}
          </button>
        ))}
      </div>

      {/* All panels are rendered (SSR-complete); non-active are hidden. */}
      {steps.map((s, i) => (
        <div
          key={s.key}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={i !== active}
          className="grid gap-6 pt-8 lg:grid-cols-[1fr_1.1fr]"
        >
          <div>
            <h3 className="font-sl-mono text-sm font-semibold tracking-wide text-sl-accent">{s.key}</h3>
            <p className="mt-3 text-lg text-sl-text">{s.plain}</p>
            <p className="mt-3 text-sm leading-relaxed text-sl-text-muted">{s.mechanism}</p>
          </div>
          <pre tabIndex={0} className="overflow-x-auto rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4 font-sl-mono text-xs leading-relaxed text-sl-text-muted">
            <code>{s.reveal}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}
