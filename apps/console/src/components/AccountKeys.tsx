"use client";
// Account-backed key management (CONSOLE_ACCOUNTS_V1). Every action goes to
// /api/console/me/* → API /v1/me/*; the page re-renders from the server, so
// what this shows is what every browser signed in to the account shows.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { AccountKey } from "@/lib/account";

type Res<T = unknown> = { ok: boolean; data?: T; error?: string };

async function call<T>(method: string, path: string, body?: unknown, idem?: string): Promise<Res<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idem) headers["Idempotency-Key"] = idem;
  const r = await fetch(`/api/console/me${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: "bad_response" }))) as Res<T>;
}

const ERR: Record<string, string> = {
  invalid_key: "That key isn't active, or isn't a Satelink key.",
  key_linked_elsewhere: "That key belongs to another account.",
  key_limit_reached: "This account already has the maximum number of keys.",
  rotate_blocked: "This key can't be rotated right now.",
  invalid_label: "Give the key a name (up to 80 characters).",
  invalid_setting: "That value isn't allowed.",
  unauthenticated: "Your session expired — sign in again.",
};
const msg = (e?: string) => ERR[e || ""] || `Something went wrong (${e || "unknown"}).`;

const btn = "h-8 rounded-[var(--sl-radius-sm)] bg-sl-accent px-3 text-xs font-semibold text-sl-accent-ink hover:bg-sl-accent-strong disabled:opacity-50";
const ghost = "rounded-[var(--sl-radius-sm)] border border-sl-border px-2 py-0.5 text-[11px] text-sl-text-muted hover:text-sl-text";
const input = "h-8 w-full rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-2 text-sl-text placeholder:text-sl-text-subtle focus:border-sl-accent focus:outline-none";

export function IssuedKey({ apiKey, note, onDone }: { apiKey: string; note?: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="rounded-[var(--sl-radius)] border border-sl-accent/40 bg-sl-surface p-3">
      <p className="font-medium text-sl-text">Copy this key now — it won&apos;t be shown again.</p>
      {note && <p className="mt-1 text-sl-text-muted">{note}</p>}
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded border border-sl-border bg-sl-bg px-2 py-1.5 font-mono text-xs" tabIndex={0}>{apiKey}</code>
        <button type="button" aria-label="Copy key" className={btn} onClick={async () => { await navigator.clipboard.writeText(apiKey); setCopied(true); }}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <button type="button" className="mt-2 text-xs text-sl-text-muted underline" onClick={onDone}>Done</button>
    </div>
  );
}

export function MigrateBanner({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  return (
    <div role="region" aria-label="Keys saved in this browser" className="mb-4 rounded-[var(--sl-radius)] border border-sl-accent/40 bg-sl-accent-soft p-3">
      <p className="font-medium text-sl-text">{count === 1 ? "1 key is" : `${count} keys are`} saved only in this browser.</p>
      <p className="mt-1 text-sl-text-muted">Save {count === 1 ? "it" : "them"} to your account so every browser and device shows the same keys, usage and billing. This browser then forgets them.</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await fetch("/api/console/me-migrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const j = (await r.json().catch(() => null)) as { ok: boolean; results?: { key: string; outcome: string }[] } | null;
            setBusy(false);
            if (!j?.ok) { setReport(msg("error")); return; }
            const elsewhere = j.results?.filter((x) => x.outcome === "linked_elsewhere").length ?? 0;
            setReport(elsewhere ? `${elsewhere} key(s) belong to another account and stayed in this browser.` : null);
            router.refresh();
          }}
        >
          {busy ? "Saving…" : "Save to my account"}
        </button>
        {report && <p role="alert" className="text-sl-warn">{report}</p>}
      </div>
    </div>
  );
}

export function CreateAccountKey() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  if (issued) return <IssuedKey apiKey={issued} onDone={() => { setIssued(null); setOpen(false); router.refresh(); }} />;
  if (!open) return <button type="button" className={btn} onClick={() => setOpen(true)}>Create key</button>;
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        // One idempotency key per form submit: a double-click or retry cannot issue two keys.
        const r = await call<{ apiKey: string }>("POST", "/keys", { label }, crypto.randomUUID());
        setBusy(false);
        if (r.ok && r.data) setIssued(r.data.apiKey);
        else setErr(msg(r.error));
      }}
    >
      <label className="min-w-[12rem] flex-1">
        <span className="mb-1 block text-[11px] text-sl-text-subtle">Key name</span>
        <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. pricing-bot" autoFocus required />
      </label>
      <button type="submit" className={btn} disabled={busy}>{busy ? "Creating…" : "Create free key"}</button>
      <button type="button" className="h-8 px-2 text-xs text-sl-text-muted" onClick={() => setOpen(false)}>Cancel</button>
      {err && <p role="alert" className="w-full text-sl-down">{err}</p>}
    </form>
  );
}

export function LinkAccountKey() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const r = await call("POST", "/keys/link", { apiKey: key.trim(), label: label || undefined });
        setBusy(false);
        if (r.ok) { setKey(""); setLabel(""); router.refresh(); } else setErr(msg(r.error));
      }}
    >
      <label className="min-w-[14rem] flex-[2]">
        <span className="mb-1 block text-[11px] text-sl-text-subtle">Existing API key</span>
        <input className={`${input} font-mono`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk_…" required />
      </label>
      <label className="min-w-[9rem] flex-1">
        <span className="mb-1 block text-[11px] text-sl-text-subtle">Name</span>
        <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="optional" />
      </label>
      <button type="submit" className={btn} disabled={busy}>{busy ? "Checking…" : "Link to account"}</button>
      {err && <p role="alert" className="w-full text-sl-down">{err}</p>}
      <p className="w-full text-[11px] text-sl-text-subtle">Presenting the key once proves you hold it. It is stored on the API only as before; this console keeps no copy.</p>
    </form>
  );
}

export function AccountKeyRow({ k }: { k: AccountKey }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "rename" | "revoke" | "rotate" | "cap">("idle");
  const [label, setLabel] = useState(k.label);
  const [cap, setCap] = useState(k.limits.dailyCapUsdt === null ? "" : String(k.limits.dailyCapUsdt));
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ apiKey: string; moved: number } | null>(null);
  const done = () => { setMode("idle"); setErr(null); router.refresh(); };
  const run = async (p: Promise<Res>) => { const r = await p; if (r.ok) done(); else setErr(msg(r.error)); return r; };

  if (issued) {
    return (
      <tr><td colSpan={7}>
        <IssuedKey apiKey={issued.apiKey} note={`The old key no longer works. ${issued.moved > 0 ? `Its balance ($${issued.moved.toFixed(6)}) moved to this key.` : ""}`} onDone={() => { setIssued(null); done(); }} />
      </td></tr>
    );
  }

  return (
    <tr>
      <td className="font-mono">{k.hint}{k.limits.paused && <span className="ml-2 rounded border border-sl-warn/50 px-1 text-[10px] text-sl-warn">paused</span>}</td>
      <td>
        {mode === "rename" ? (
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); run(call("PATCH", `/keys/${k.id}`, { label })); }}>
            <label className="sr-only" htmlFor={`label-${k.id}`}>Key name</label>
            <input id={`label-${k.id}`} className={input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} autoFocus />
            <button className={ghost} type="submit">Save</button>
          </form>
        ) : k.label}
      </td>
      <td>{k.tier}</td>
      <td className="text-right">${k.balanceUsdt.toFixed(4)}</td>
      <td className="text-right">
        {mode === "cap" ? (
          <form className="flex justify-end gap-1" onSubmit={(e) => { e.preventDefault(); run(call("PUT", `/keys/${k.id}/limits`, { dailyCapUsdt: cap === "" ? null : Number(cap) })); }}>
            <label className="sr-only" htmlFor={`cap-${k.id}`}>Daily spend cap in USD</label>
            <input id={`cap-${k.id}`} className={`${input} w-24 text-right`} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="no cap" autoFocus />
            <button className={ghost} type="submit">Save</button>
          </form>
        ) : k.limits.dailyCapUsdt === null ? <span className="text-sl-text-subtle">no cap</span> : `$${k.limits.dailyCapUsdt}/day`}
      </td>
      <td>{k.lastUsed ? new Date(k.lastUsed).toLocaleDateString() : <span className="text-sl-text-subtle">never</span>}</td>
      <td>
        <div className="flex flex-wrap justify-end gap-1.5">
          {mode === "revoke" ? (
            <>
              <button type="button" className="rounded border border-sl-down/50 px-2 py-0.5 text-[11px] text-sl-down" onClick={() => run(call("POST", `/keys/${k.id}/revoke`, {}))}>Revoke now{k.balanceUsdt > 0 ? ` ($${k.balanceUsdt.toFixed(4)} stays on it)` : ""}</button>
              <button type="button" className="px-1 text-[11px] text-sl-text-muted" onClick={() => setMode("idle")}>Cancel</button>
            </>
          ) : mode === "rotate" ? (
            <>
              <button
                type="button"
                className="rounded border border-sl-warn/50 px-2 py-0.5 text-[11px] text-sl-warn"
                onClick={async () => {
                  const r = await call<{ apiKey: string; movedCreditsUsdt: number }>("POST", `/keys/${k.id}/rotate`, {}, crypto.randomUUID());
                  if (r.ok && r.data) setIssued({ apiKey: r.data.apiKey, moved: r.data.movedCreditsUsdt }); else setErr(msg(r.error));
                }}
              >
                Confirm rotate
              </button>
              <button type="button" className="px-1 text-[11px] text-sl-text-muted" onClick={() => setMode("idle")}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className={ghost} onClick={() => run(call("PUT", `/keys/${k.id}/limits`, { paused: !k.limits.paused }))}>{k.limits.paused ? "Resume" : "Pause"}</button>
              <button type="button" className={ghost} onClick={() => setMode("cap")}>Cap</button>
              <button type="button" className={ghost} onClick={() => setMode("rename")}>Rename</button>
              <button type="button" className={ghost} onClick={() => setMode("rotate")}>Rotate</button>
              <button type="button" className={ghost} onClick={() => setMode("revoke")}>Revoke</button>
            </>
          )}
        </div>
        {err && <p role="alert" className="mt-1 text-right text-[11px] text-sl-down">{err}</p>}
      </td>
    </tr>
  );
}
