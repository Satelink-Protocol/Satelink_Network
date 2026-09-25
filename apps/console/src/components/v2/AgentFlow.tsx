"use client";
// Simple-mode task flow: "Give my software access". Name it → choose what it
// can use → monthly limit → key shown once (+ Test it) → done.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Done, FlowCard, Stepper, field, primaryBtn, secondaryBtn } from "./Flow";
import { Help } from "./Help";

const STEPS = ["Name", "What it can use", "Monthly limit", "Your key"];
type Created = { id: number; apiKey: string; hint: string };

export function AgentFlow() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<{ intelligence: boolean; rpc: boolean }>({ intelligence: true, rpc: false });
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [idem] = useState(() => crypto.randomUUID());
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [done, setDone] = useState(false);

  const capNum = cap.trim() === "" ? null : Number(cap);
  const capValid = capNum === null || (Number.isFinite(capNum) && capNum >= 0 && capNum <= 100000);
  const chosen = (Object.keys(scopes) as ("intelligence" | "rpc")[]).filter((k) => scopes[k]);

  async function create() {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/console/me/keys", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idem }, body: JSON.stringify({ label: name.trim(), role: "agent" }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) { setBusy(false); setErr("Couldn't create the key. Try again."); return; }
    const k = j.data as Created;
    const lim = await fetch(`/api/console/me/keys/${k.id}/limits`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scopes: chosen, monthlyCapUsdt: capNum }) });
    setBusy(false);
    if (!lim.ok) setErr("The key was created, but its limits weren't saved — set them on the Agents page.");
    setCreated(k);
    setStep(3);
  }

  if (done && created) {
    return (
      <div className="mx-auto max-w-2xl">
        <FlowCard title="All set">
          <Done title={`${name} can now use Satelink`} body={<>It can use {chosen.map((s) => (s === "intelligence" ? "market data" : "blockchain RPC")).join(" and ")}{capNum !== null ? `, up to $${capNum} a month` : ""}. Add money so it has something to spend.</>}
            next={[{ label: "Add money", href: "/billing/add" }, { label: "See all agents", href: "/agents" }, { label: "Home", href: "/" }]} />
        </FlowCard>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Stepper steps={STEPS} current={step} />
      {step === 0 && (
        <FlowCard title="What should we call it?" lede="A name you'll recognise later — the app, bot or script that will use this access.">
          <label className="block">
            <span className="mb-1 block text-[13px] text-sl-text-muted">Name</span>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. pricing-bot" autoFocus />
          </label>
          <div className="mt-6 flex justify-end"><button type="button" className={primaryBtn} disabled={!name.trim()} onClick={() => setStep(1)}>Continue</button></div>
        </FlowCard>
      )}
      {step === 1 && (
        <FlowCard title="What can it use?" lede="It can only spend on what you tick. You can change this later.">
          <fieldset className="space-y-2">
            <legend className="sr-only">Products</legend>
            {([["intelligence", "Market data", "Funding rates, open interest, order books ($0.01 per request)"], ["rpc", "Blockchain RPC", "Read the Polygon blockchain ($0.00003 per call, paid from crypto credits)"]] as const).map(([k, t, d]) => (
              <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-[var(--sl-radius)] border p-3.5 ${scopes[k] ? "border-sl-accent bg-sl-accent-soft" : "border-sl-border"}`}>
                <input type="checkbox" checked={scopes[k]} onChange={(e) => setScopes((s) => ({ ...s, [k]: e.target.checked }))} className="mt-1 accent-[var(--sl-accent)]" />
                <span><span className="block text-[15px] text-sl-text">{t}{k === "rpc" && <Help term="RPC" label="What's RPC?" />}</span><span className="mt-0.5 block text-[13px] text-sl-text-muted">{d}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="mt-6 flex justify-between">
            <button type="button" className={secondaryBtn} onClick={() => setStep(0)}>Back</button>
            <button type="button" className={primaryBtn} disabled={chosen.length === 0} onClick={() => setStep(2)}>Continue</button>
          </div>
        </FlowCard>
      )}
      {step === 2 && (
        <FlowCard title="Set a monthly limit" lede="The most it may spend in a calendar month. Leave empty for no limit.">
          <label className="block">
            <span className="mb-1 block text-[13px] text-sl-text-muted">Monthly limit in US dollars</span>
            <input className={field} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="No limit" />
          </label>
          {!capValid && <p role="alert" className="mt-2 text-sl-down">Enter an amount between 0 and 100,000.</p>}
          {err && <p role="alert" className="mt-2 text-sl-down">{err}</p>}
          <div className="mt-6 flex justify-between">
            <button type="button" className={secondaryBtn} onClick={() => setStep(1)}>Back</button>
            <button type="button" className={primaryBtn} disabled={!capValid || busy} onClick={create}>{busy ? "Creating…" : "Create access"}</button>
          </div>
        </FlowCard>
      )}
      {step === 3 && created && (
        <FlowCard title="Here is its key" lede="Copy it into your software now. For your safety it won't be shown again.">
          {err && <p role="alert" className="mb-3 text-sl-warn">{err}</p>}
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-[var(--sl-radius)] border border-sl-border bg-sl-bg px-3 py-2.5 font-mono text-[13px] text-sl-text" tabIndex={0} data-testid="issued-key">{created.apiKey}</code>
            <button type="button" className={secondaryBtn} onClick={async () => { await navigator.clipboard.writeText(created.apiKey); setCopied(true); }}>
              {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}{copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" className={secondaryBtn} disabled={test === "running"} onClick={async () => {
              setTest("running");
              const r = await fetch("/api/console/test-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: created.apiKey }) });
              const j = await r.json().catch(() => null);
              setTest(j?.ok ? "ok" : "fail");
            }}>{test === "running" ? "Testing…" : "Test it"}</button>
            {test === "ok" && <p role="status" className="text-sl-text">It works — Satelink recognises this key. Nothing was charged.</p>}
            {test === "fail" && <p role="alert" className="text-sl-down">The test didn't pass. Try again in a moment.</p>}
          </div>
          <div className="mt-6 flex justify-end"><button type="button" className={primaryBtn} onClick={() => setDone(true)}>I've saved the key</button></div>
        </FlowCard>
      )}
    </div>
  );
}
