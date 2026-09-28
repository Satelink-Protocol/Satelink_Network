"use client";
// Server-side saved Trading Intelligence queries (D10): run opens the market-data
// flow on that metric + market; delete removes it for the account (not this browser).
import Link from "next/link";
import { useState } from "react";
import type { SavedQuery } from "@/lib/v2-shared";

export function SavedQueries({ initial }: { initial: SavedQuery[] }) {
  const [items, setItems] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  async function remove(id: number) {
    setErr(null);
    const r = await fetch(`/api/console/me/saved-queries/${id}`, { method: "DELETE" });
    const j = await r.json().catch(() => null);
    if (!j?.ok) { setErr("Couldn't delete that query. Try again."); return; }
    setItems((xs) => xs.filter((x) => x.id !== id));
  }
  if (items.length === 0) return <p className="text-sl-text-muted">No saved queries yet. Run a metric below and choose “Save this query” — it is stored on your account, so it appears on every device.</p>;
  return (
    <div>
      {err && <p role="alert" className="mb-2 text-sl-down">{err}</p>}
      <ul className="divide-y divide-sl-border/60">
        {items.map((q) => (
          <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
            <span>
              <span className="text-sl-text">{q.name}</span>
              <span className="ml-2 font-mono text-[11px] text-sl-text-subtle">{q.query.metric}{q.query.symbol ? ` · ${q.query.symbol}` : ""}</span>
            </span>
            <span className="flex gap-2">
              {q.query.metric && <Link className="text-xs text-sl-accent hover:underline" href={`/data?metric=${encodeURIComponent(q.query.metric)}${q.query.symbol ? `&symbol=${encodeURIComponent(q.query.symbol)}` : ""}`}>Run</Link>}
              <button type="button" onClick={() => remove(q.id)} className="text-xs text-sl-text-muted hover:text-sl-down">Delete</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
