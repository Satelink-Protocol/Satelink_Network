"use client";
// Server-side account settings (CONSOLE_ACCOUNTS_V1 → /v1/me/settings). The
// same values apply on every browser; caps and auto-use are enforced by the API
// on every paid call, not by this page.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountSettings } from "@/lib/v2-shared";

const TZ = ["UTC", "Asia/Kolkata", "Asia/Singapore", "Asia/Dubai", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];
const input = "h-9 w-full rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-2 text-[13px] text-sl-text";

export function Preferences({ initial }: { initial: AccountSettings }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [cap, setCap] = useState(initial.monthlySpendCapUsdt === null ? "" : String(initial.monthlySpendCapUsdt));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  const tzs = TZ.includes(s.timezone) ? TZ : [s.timezone, ...TZ];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const body = { defaultMode: s.defaultMode, timezone: s.timezone, creditAutoUse: s.creditAutoUse, alertThresholds: s.alertThresholds, notifications: s.notifications, monthlySpendCapUsdt: cap.trim() === "" ? null : Number(cap) };
    const r = await fetch("/api/console/me/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (j?.ok) { setState("saved"); document.cookie = `slc_mode=${s.defaultMode}; path=/; max-age=31536000; samesite=strict`; router.refresh(); }
    else { setState("error"); setMsg(j?.error === "invalid_setting" ? "One of the values isn't allowed." : "Couldn't save."); }
  }

  const t = (k: string) => Boolean(s.notifications?.[k]);
  return (
    <form onSubmit={save} className="grid gap-4 md:grid-cols-2" id="spending">
      <label className="block text-[13px]"><span className="mb-1 block text-sl-text-muted">Console mode on sign-in</span>
        <select className={input} value={s.defaultMode} onChange={(e) => setS({ ...s, defaultMode: e.target.value as "simple" | "advanced" })}><option value="simple">Simple</option><option value="advanced">Advanced</option></select>
      </label>
      <label className="block text-[13px]"><span className="mb-1 block text-sl-text-muted">Timezone (weekly allowance resets on Monday here)</span>
        <select className={input} value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })}>{tzs.map((z) => <option key={z}>{z}</option>)}</select>
      </label>
      <label className="block text-[13px]"><span className="mb-1 block text-sl-text-muted">Monthly spend cap for the whole account (USD, credits)</span>
        <input className={input} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="No cap" />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-sl-text md:mt-6">
        <input type="checkbox" checked={s.creditAutoUse} onChange={(e) => setS({ ...s, creditAutoUse: e.target.checked })} className="accent-[var(--sl-accent)]" />
        Use crypto credits automatically when my plan allowance runs out
      </label>
      <fieldset className="text-[13px]"><legend className="mb-1 text-sl-text-muted">Warn me at (% of allowance)</legend>
        <div className="flex flex-wrap gap-3">{[70, 85, 95, 100].map((n) => (
          <label key={n} className="flex items-center gap-1.5 text-sl-text"><input type="checkbox" className="accent-[var(--sl-accent)]" checked={s.alertThresholds.includes(n)}
            onChange={(e) => setS({ ...s, alertThresholds: e.target.checked ? [...s.alertThresholds, n].sort((a, b) => a - b) : s.alertThresholds.filter((x) => x !== n) })} />{n}%</label>
        ))}</div>
      </fieldset>
      <fieldset className="text-[13px]"><legend className="mb-1 text-sl-text-muted">Email me about</legend>
        {([["usageAlerts", "Usage warnings"], ["email", "Receipts and account notices"], ["productUpdates", "Product updates"]] as const).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5 text-sl-text"><input type="checkbox" className="accent-[var(--sl-accent)]" checked={t(k)} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, [k]: e.target.checked } })} />{l}</label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3 md:col-span-2">
        <button type="submit" disabled={state === "saving"} className="h-9 rounded-[var(--sl-radius-sm)] bg-sl-accent px-4 text-[13px] font-medium text-sl-accent-ink">{state === "saving" ? "Saving…" : "Save settings"}</button>
        {state === "saved" && <span role="status" className="text-[13px] text-sl-text-muted">Saved — applies on every device.</span>}
        {state === "error" && <span role="alert" className="text-[13px] text-sl-down">{msg}</span>}
      </div>
    </form>
  );
}
