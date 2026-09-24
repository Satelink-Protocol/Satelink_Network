"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: "bad_response" }))) as { ok: boolean; error?: string; key?: string };
}

const ERR: Record<string, string> = {
  invalid_key_format: "That doesn't look like a Satelink API key (they start with sk_).",
  key_not_recognised: "The API didn't recognise that key.",
  already_connected: "That key is already connected.",
  too_many_keys: "You can connect up to 10 keys in this console.",
  name_required: "Give the key a name.",
  api_unavailable: "The API is unavailable right now. Try again shortly.",
  unauthenticated: "Your session has expired. Sign in again.",
};

const input = "h-8 w-full rounded border border-sl-border bg-sl-bg px-2 text-sl-text placeholder:text-sl-text-subtle focus:border-sl-accent focus:outline-none";
const btn = "h-8 rounded bg-sl-accent px-3 text-xs font-semibold text-sl-accent-ink hover:bg-sl-accent-strong disabled:opacity-50";

export function CreateKey({ noun = "key" }: { noun?: "key" | "agent" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get("new") === "1");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (issued) {
    return (
      <div role="status" className="rounded-md border border-sl-accent/40 bg-sl-surface p-3">
        <p className="font-medium text-sl-text">Copy this key now — it won&apos;t be shown again.</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded border border-sl-border bg-sl-bg px-2 py-1.5 font-mono text-xs">{issued}</code>
          <button
            type="button"
            className={btn}
            onClick={async () => { await navigator.clipboard.writeText(issued); setCopied(true); }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>
        <p className="mt-2 text-sl-text-muted">Test it:</p>
        <pre tabIndex={0} className="mt-1 overflow-x-auto rounded border border-sl-border bg-sl-bg p-2 font-mono text-[11px] text-sl-text-muted">{`curl -X POST https://rpc.satelink.network/rpc/polygon \\
  -H "X-API-Key: ${issued.slice(0, 7)}…" -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`}</pre>
        <button type="button" className="mt-2 text-xs text-sl-text-muted underline" onClick={() => { setIssued(null); setOpen(false); router.refresh(); }}>
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return <button type="button" className={btn} onClick={() => setOpen(true)}>{noun === "agent" ? "Create agent" : "Create key"}</button>;
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border border-sl-border bg-sl-surface p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const r = await post("/api/console/keys/create", { label });
        setBusy(false);
        if (r.ok && r.key) setIssued(r.key);
        else setErr(ERR[r.error || ""] || `Couldn't create a key (${r.error}).`);
      }}
    >
      <label className="min-w-[12rem] flex-1">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-sl-text-subtle">{noun === "agent" ? "Agent name" : "Key name"}</span>
        <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder={noun === "agent" ? "e.g. pricing-bot" : "e.g. production"} autoFocus required />
      </label>
      <button type="submit" className={btn} disabled={busy}>{busy ? "Creating…" : "Create free key"}</button>
      <button type="button" className="h-8 px-2 text-xs text-sl-text-muted" onClick={() => setOpen(false)}>Cancel</button>
      {err && <p role="alert" className="w-full text-sl-down">{err}</p>}
      <p className="w-full text-[11px] text-sl-text-subtle">Issues a real free-tier key on the API. Upgrade it later with a USDT deposit or a plan.</p>
    </form>
  );
}

export function ConnectKey() {
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
        const r = await post("/api/console/keys/connect", { key, label });
        setBusy(false);
        if (r.ok) { setKey(""); setLabel(""); router.refresh(); }
        else setErr(ERR[r.error || ""] || `Couldn't connect (${r.error}).`);
      }}
    >
      <label className="min-w-[14rem] flex-[2]">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-sl-text-subtle">Existing API key</span>
        <input className={`${input} font-mono`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk_…" required />
      </label>
      <label className="min-w-[9rem] flex-1">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-sl-text-subtle">Label</span>
        <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="optional" />
      </label>
      <button type="submit" className={btn} disabled={busy}>{busy ? "Checking…" : "Connect"}</button>
      {err && <p role="alert" className="w-full text-sl-down">{err}</p>}
    </form>
  );
}

export function RowActions({ fp, active }: { fp: string; active: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex justify-end gap-1.5">
      {!active && (
        <button type="button" className="rounded border border-sl-border px-2 py-0.5 text-[11px] hover:border-sl-accent" onClick={async () => { await post("/api/console/keys/active", { fp }); router.refresh(); }}>
          Use
        </button>
      )}
      {confirm ? (
        <>
          <button type="button" className="rounded border border-sl-down/50 px-2 py-0.5 text-[11px] text-sl-down" onClick={async () => { await post("/api/console/keys/remove", { fp }); router.refresh(); }}>
            Confirm disconnect
          </button>
          <button type="button" className="px-1 text-[11px] text-sl-text-muted" onClick={() => setConfirm(false)}>Cancel</button>
        </>
      ) : (
        <button type="button" className="rounded border border-sl-border px-2 py-0.5 text-[11px] text-sl-text-muted hover:text-sl-text" onClick={() => setConfirm(true)}>
          Disconnect
        </button>
      )}
    </div>
  );
}
