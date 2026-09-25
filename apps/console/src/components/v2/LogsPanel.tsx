"use client";
// Per-request log explorer (session → /v1/me/requests): filters, keyset
// pagination, receipt ids. Latency / UU are shown only when recorded.
import { useEffect, useState } from "react";
import type { RequestLog } from "@/lib/v2-shared";

const RANGE_SEC: Record<string, number> = { "1h": 3600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400 };

export function LogsPanel({ initial, keys, keyVar, productVar, range }: { initial: RequestLog | null; keys: { id: number; label: string }[]; keyVar: string; productVar: string; range: string }) {
  const [items, setItems] = useState(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(initial ? null : "Couldn't load the request log.");

  const qs = (c?: string | null) => {
    const q = new URLSearchParams({ limit: "50", from: String(Math.floor(Date.now() / 1000) - (RANGE_SEC[range] ?? RANGE_SEC["30d"])) });
    if (keyVar !== "all") q.set("keyId", keyVar);
    if (productVar !== "all") q.set("product", productVar);
    if (status) q.set("status", status);
    if (c) q.set("cursor", c);
    return q.toString();
  };
  async function load(c?: string | null) {
    setBusy(true);
    const r = await fetch(`/api/console/requests?${qs(c)}`);
    const j = await r.json().catch(() => null);
    setBusy(false);
    if (!j?.ok) { setErr("Couldn't load the request log."); return; }
    setErr(null);
    setItems((prev) => (c ? [...prev, ...j.data.items] : j.data.items));
    setCursor(j.data.nextCursor);
  }
  useEffect(() => { load(null); }, [keyVar, productVar, status, range]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
        <label className="flex items-center gap-1 text-sl-text-muted">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-7 rounded border border-sl-border bg-sl-surface px-1.5 text-sl-text">
            <option value="">Any</option><option value="completed">completed</option><option value="failed">failed</option><option value="pending">pending</option>
          </select>
        </label>
        <span className="text-sl-text-subtle">{items.length} shown{cursor ? " · more available" : ""}</span>
      </div>
      {err && <p role="alert" className="text-sl-down">{err}</p>}
      {items.length === 0 && !err ? <p className="text-sl-text-muted">No requests match.</p> : (
        <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Request log table">
          <table className="tnum w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-sl-surface"><tr className="text-sl-text-subtle">{["Time", "Key", "Product", "Method", "Status", "Cost", "Receipt"].map((h) => <th key={h} scope="col" className="border-b border-sl-border px-1.5 py-1 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={`${r.receiptId}-${r.at}`} className="border-b border-sl-border/50">
                  <td className="whitespace-nowrap px-1.5 py-1">{new Date(r.at).toLocaleString()}</td>
                  <td className="px-1.5 py-1">{keys.find((k) => k.id === r.key.id)?.label ?? r.key.hint}</td>
                  <td className="px-1.5 py-1">{r.product === "intelligence" ? "market data" : r.product}</td>
                  <td className="px-1.5 py-1 font-mono">{r.method ?? ""}</td>
                  <td className={`px-1.5 py-1 ${r.status === "completed" ? "text-sl-text" : "text-sl-warn"}`}>{r.status}</td>
                  <td className="px-1.5 py-1">${r.costUsdt.toFixed(5)}</td>
                  <td className="max-w-[14rem] truncate px-1.5 py-1 font-mono text-sl-text-muted" title={r.receiptId ?? ""}>{r.receiptId ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && <button type="button" onClick={() => load(cursor)} disabled={busy} className="mt-2 h-8 rounded border border-sl-border px-3 text-[12px]">{busy ? "Loading…" : "Load more"}</button>}
    </div>
  );
}
