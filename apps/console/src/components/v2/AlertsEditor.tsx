"use client";
// Alert preferences + "Send test alert" (D7 → /v1/me/alerts). Usage levels and
// the usage/notice switches are edited in Settings (one source of truth); this
// form owns the rest. The API evaluates alerts every few minutes and emails
// the account address; nothing here is decided in the browser.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AlertPrefs } from "@/lib/v2-shared";

const input = "h-9 w-full rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-2 text-[13px] text-sl-text";
const COOLDOWNS: [number, string][] = [[60, "1 hour"], [360, "6 hours"], [1440, "1 day"], [10080, "1 week"]];

export function AlertsEditor({ initial, senderConfigured }: { initial: AlertPrefs; senderConfigured: boolean }) {
  const router = useRouter();
  const [floor, setFloor] = useState(initial.lowBalanceUsdt === null ? "" : String(initial.lowBalanceUsdt));
  const [errPct, setErrPct] = useState(initial.errorRatePct === null ? "" : String(initial.errorRatePct));
  const [deposits, setDeposits] = useState(initial.depositConfirmed);
  const [cooldown, setCooldown] = useState(initial.cooldownMinutes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [test, setTest] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [testMsg, setTestMsg] = useState("");
  const cooldowns = COOLDOWNS.some(([m]) => m === cooldown) ? COOLDOWNS : [[cooldown, `${cooldown} minutes`] as [number, string], ...COOLDOWNS];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const body = {
      lowBalanceUsdt: floor.trim() === "" ? null : Number(floor),
      errorRatePct: errPct.trim() === "" ? null : Number(errPct),
      depositConfirmed: deposits,
      cooldownMinutes: cooldown,
    };
    const r = await fetch("/api/console/me/alerts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (j?.ok) { setState("saved"); router.refresh(); }
    else { setState("error"); setMsg(j?.error === "invalid_setting" ? "One of the values isn't allowed." : "Couldn't save. Try again."); }
  }

  async function sendTest() {
    setTest("sending");
    const r = await fetch("/api/console/me/alerts/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => null);
    if (j?.ok) {
      const d = j.data?.delivery;
      setTest(d === "sent" ? "done" : "error");
      setTestMsg(d === "sent" ? "Test alert sent — check your inbox." : d === "skipped_no_sender" ? "Email sending isn't configured yet, so nothing was sent." : "The email provider refused the message. It's recorded below.");
      router.refresh();
    } else {
      setTest("error");
      setTestMsg(r.status === 429 ? "You can send 3 test alerts an hour." : "Couldn't send a test alert.");
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <label className="block text-[13px]"><span className="mb-1 block text-sl-text-muted">Warn me when a key's RPC credits fall below (USD)</span>
          <input className={input} inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="Off" aria-describedby="floor-help" />
          <span id="floor-help" className="mt-1 block text-[12px] text-sl-text-subtle">Only keys that were funded at least once. Card-funded value is for Trading Intelligence and isn't counted.</span>
        </label>
        <label className="block text-[13px]"><span className="mb-1 block text-sl-text-muted">Don't repeat a low-balance warning for</span>
          <select className={input} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))}>{cooldowns.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-sl-text">
          <input type="checkbox" checked={deposits} onChange={(e) => setDeposits(e.target.checked)} className="accent-[var(--sl-accent)]" />
          Email me when a deposit is confirmed and credited
        </label>
        <label className="block text-[13px]"><span className="mb-1 block text-sl-text-muted">Error-rate threshold (%)</span>
          <input className={input} inputMode="decimal" value={errPct} onChange={(e) => setErrPct(e.target.value)} placeholder="Off" aria-describedby="err-help" />
          <span id="err-help" className="mt-1 block text-[12px] text-sl-text-subtle">Saved now, but not measured yet: failed calls aren't recorded per request, so no error-rate alert can be sent.</span>
        </label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button type="submit" disabled={state === "saving"} className="h-9 rounded-[var(--sl-radius-sm)] bg-sl-accent px-4 text-[13px] font-medium text-sl-accent-ink">{state === "saving" ? "Saving…" : "Save alerts"}</button>
          {state === "saved" && <span role="status" className="text-[13px] text-sl-text-muted">Saved.</span>}
          {state === "error" && <span role="alert" className="text-[13px] text-sl-down">{msg}</span>}
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-3 border-t border-sl-border pt-4">
        <button type="button" onClick={sendTest} disabled={test === "sending"} className="h-9 rounded-[var(--sl-radius-sm)] border border-sl-border px-4 text-[13px] font-medium text-sl-text">
          {test === "sending" ? "Sending…" : "Send test alert"}
        </button>
        {!senderConfigured && test === "idle" && <span className="text-[13px] text-sl-text-muted">Email sending isn't configured yet.</span>}
        {test === "done" && <span role="status" className="text-[13px] text-sl-text-muted">{testMsg}</span>}
        {test === "error" && <span role="alert" className="text-[13px] text-sl-down">{testMsg}</span>}
      </div>
    </div>
  );
}
