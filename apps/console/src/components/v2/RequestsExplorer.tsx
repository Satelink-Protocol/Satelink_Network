"use client";
// Full-page request log (D5): key / product / time-range filters around LogsPanel.
import { useState } from "react";
import type { RequestLog } from "@/lib/v2-shared";
import { LogsPanel } from "./LogsPanel";

export function RequestsExplorer({ initial, keys }: { initial: RequestLog | null; keys: { id: number; label: string }[] }) {
  const [keyVar, setKey] = useState("all");
  const [productVar, setProduct] = useState("all");
  const [range, setRange] = useState("7d");
  const sel = "h-7 rounded border border-sl-border bg-sl-surface px-1.5 text-sl-text";
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-[12px]">
        <label className="flex items-center gap-1 text-sl-text-muted">Key
          <select value={keyVar} onChange={(e) => setKey(e.target.value)} className={sel}>
            <option value="all">All keys</option>
            {keys.map((k) => <option key={k.id} value={String(k.id)}>{k.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sl-text-muted">Product
          <select value={productVar} onChange={(e) => setProduct(e.target.value)} className={sel}>
            <option value="all">All</option><option value="rpc">RPC</option><option value="intelligence">Market data</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-sl-text-muted">Period
          <select value={range} onChange={(e) => setRange(e.target.value)} className={sel}>
            <option value="1h">1 hour</option><option value="24h">24 hours</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="90d">90 days</option>
          </select>
        </label>
      </div>
      <LogsPanel initial={initial} keys={keys} keyVar={keyVar} productVar={productVar} range={range} />
    </div>
  );
}
