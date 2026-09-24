"use client";

import { useState } from "react";

type Metric = { metric: string; price_usdt: number; description: string; kind: string };

export function TiPlayground({ metrics, hasKey }: { metrics: Metric[]; hasKey: boolean }) {
  const [metric, setMetric] = useState(metrics[0]?.metric ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: number; ms: number; body: unknown } | null>(null);
  const m = metrics.find((x) => x.metric === metric);

  const run = async () => {
    setBusy(true);
    setConfirming(false);
    const r = await fetch("/api/console/ti", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metric }) });
    const j = await r.json().catch(() => ({ status: r.status, ms: 0, body: { error: "bad_response" } }));
    setResult({ status: j.status ?? r.status, ms: j.ms ?? 0, body: j.body });
    setBusy(false);
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-sl-text-subtle">Metric</span>
          <select value={metric} onChange={(e) => { setMetric(e.target.value); setResult(null); }} className="h-8 w-full rounded border border-sl-border bg-sl-bg px-2 font-mono text-xs text-sl-text">
            {metrics.map((x) => <option key={x.metric} value={x.metric}>{x.metric}</option>)}
          </select>
        </label>
        {m && (
          <div className="rounded border border-sl-border p-2 text-sl-text-muted">
            <p>{m.description}</p>
            <p className="mt-1 tnum text-sl-text">Cost per call: <b>{m.price_usdt} USDT</b></p>
          </div>
        )}
        {!hasKey ? (
          <p className="text-sl-text-muted">Connect a key to run a call.</p>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded border border-sl-warn/50 p-2">
            <span className="text-sl-text">Run one call, charged {m?.price_usdt} USDT to the active key?</span>
            <button type="button" onClick={run} className="h-7 rounded bg-sl-accent px-2.5 text-xs font-semibold text-sl-accent-ink">Run</button>
            <button type="button" onClick={() => setConfirming(false)} className="h-7 px-2 text-xs text-sl-text-muted">Cancel</button>
          </div>
        ) : (
          <button type="button" disabled={busy || !m} onClick={() => setConfirming(true)} className="h-8 rounded bg-sl-accent px-3 text-xs font-semibold text-sl-accent-ink disabled:opacity-50">
            {busy ? "Running…" : "Run query"}
          </button>
        )}
      </div>
      <div className="min-h-[12rem] rounded border border-sl-border bg-sl-bg">
        <div className="flex items-center gap-3 border-b border-sl-border px-2 py-1 font-mono text-[11px] text-sl-text-subtle">
          <span>GET /v1/intelligence/{metric}</span>
          {result && <span className={result.status === 200 ? "text-sl-accent" : "text-sl-down"}>{result.status}</span>}
          {result && <span>{result.ms} ms</span>}
        </div>
        <pre tabIndex={0} aria-live="polite" className="max-h-[28rem] overflow-auto p-2 font-mono text-[11px] leading-relaxed text-sl-text-muted">
          {result ? JSON.stringify(result.body, null, 2) : "Response appears here."}
        </pre>
      </div>
    </div>
  );
}
