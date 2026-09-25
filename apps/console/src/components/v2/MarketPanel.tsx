"use client";
// Paid market-data panel. Never auto-runs or auto-refreshes: each run is an
// explicit click that shows its price. Renders only what the API returns
// (point-in-time snapshots — no OHLC, so no candles; no series, so no moving
// averages). Model-derived data is labelled as such. Not advice.
import { useState } from "react";
import { BarList, Heatmap } from "./charts";

type Row = Record<string, unknown>;
type Res = { ok: boolean; as_of?: string; billed_usdt?: number; data?: { symbols?: Row[]; has_baseline?: boolean }; error?: string; message?: string };
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function MarketPanel({ metric, keys, keyVar }: { metric: string; keys: { id: number; label: string; scopes: string[] | null }[]; keyVar: string }) {
  const usable = keys.filter((k) => !k.scopes || k.scopes.includes("intelligence"));
  const keyId = keyVar !== "all" && usable.some((k) => String(k.id) === keyVar) ? Number(keyVar) : usable[0]?.id;
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!keyId) return;
    setBusy(true);
    const r = await fetch(`/api/console/me/intelligence/${metric}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyId }) });
    setRes((await r.json().catch(() => ({ ok: false, error: "bad_response" }))) as Res);
    setBusy(false);
  }

  const rows = res?.data?.symbols ?? [];
  let body: React.ReactNode = null;
  if (res?.ok && rows.length) {
    if (metric === "funding-rate-heatmap") {
      const top = rows.slice(0, 10);
      const exchanges = [...new Set(top.flatMap((r) => ((r.per_exchange as Row[]) ?? []).map((e) => String(e.exchange))))].sort();
      body = <Heatmap title="Annualised funding by symbol × exchange (top 10 by divergence)" rows={top.map((r) => String(r.symbol))} cols={exchanges} mode="diverging" fmt={pct}
        value={(sym, ex) => { const e = ((top.find((r) => r.symbol === sym)?.per_exchange as Row[]) ?? []).find((x) => x.exchange === ex); return e ? Number(e.funding_apr) : null; }}
        caption="Teal = positive (longs pay shorts), amber = negative. Gross of fees." />;
    } else if (metric === "open-interest-shifts") {
      const top = rows.filter((r) => r.change_pct !== null).slice(0, 10);
      body = top.length ? <BarList title="Open-interest change since previous snapshot (absolute)" items={top.map((r) => ({ label: `${r.symbol} ${Number(r.change_pct) < 0 ? "↓" : "↑"}`, value: Math.abs(Number(r.change_pct)) }))} fmt={pct} /> : <p className="text-sl-text-muted">No earlier snapshot to compare against yet.</p>;
    } else if (metric === "market-microstructure") {
      body = <BarList title="Tightest spreads (bps)" items={rows.slice(0, 10).map((r) => ({ label: `${r.symbol} · ${r.exchange}`, value: Number(r.spread_bps) }))} fmt={(v) => v.toFixed(2)} color="var(--chart-4)" />;
    } else {
      const r0 = rows[0];
      const cl = (r0.clusters as Row[]) ?? [];
      body = <BarList title={`${r0.symbol}: estimated liquidation prices by leverage — MODEL`} items={cl.map((c) => ({ label: `${c.leverage}× ${String(c.side).startsWith("long") ? "long" : "short"}`, value: Number(c.price) }))} fmt={(v) => `$${v.toLocaleString()}`} color="var(--chart-2)" caption="Derived from public mark price and funding. Not measured exchange orders." />;
    }
  }

  return (
    <div>
      {!res && <p className="text-[13px] text-sl-text-muted">Runs on demand. Each run costs $0.01 (or 10 UU from your plan).</p>}
      {res && !res.ok && <p role="alert" className="text-[13px] text-sl-down">{res.message ?? res.error}</p>}
      {res?.ok && <p className="mb-2 text-[11px] text-sl-text-subtle">As of {res.as_of ? new Date(res.as_of).toLocaleString() : "now"} · charged ${Number(res.billed_usdt ?? 0).toFixed(2)} · snapshot data, so no indicator overlays · not advice</p>}
      {body}
      <button type="button" onClick={run} disabled={!keyId || busy} className="mt-3 h-8 rounded-[var(--sl-radius-sm)] border border-sl-border px-3 text-[12px] text-sl-text hover:border-sl-accent disabled:opacity-50">
        {!keyId ? "Needs a key with market-data access" : busy ? "Running…" : res ? "Run again ($0.01)" : "Run ($0.01)"}
      </button>
    </div>
  );
}
