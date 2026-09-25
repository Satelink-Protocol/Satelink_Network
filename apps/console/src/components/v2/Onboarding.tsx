"use client";
// First-run onboarding (CONSOLE_ONBOARDING_V1), in the claude.ai pattern: one
// question per screen, plain words, one primary action. Every step is saved on
// the server, so the flow resumes wherever the account left off — on any
// browser. Prices, allowances and intro copy come from the PlanCatalog.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, ShieldCheck, Wallet } from "lucide-react";
import { Choice, FlowCard, Stepper, field, primaryBtn, secondaryBtn } from "./Flow";
import type { PlanCatalog } from "@/lib/v2-shared";
import { TASKS, USE_CASE_LABELS, USE_CASE_TASKS, stepIndex, visibleSteps, type Onboarding as OB } from "@/lib/onboarding";

type Plan = PlanCatalog["plans"][number];

const ERRORS: Record<string, string> = {
  terms_required: "Accept the Terms of Service and Acceptable Use Policy to continue.",
  age_required: "Confirm you're 18 or older to continue.",
  dpdp_required: "Consent to the processing described in the privacy notice to continue.",
  invalid_name: "Enter a name up to 80 characters.",
  invalid_use_case: "Choose what you'll use Satelink for.",
  invalid_first_task: "Pick a first task, or choose to explore yourself.",
  no_yearly: "This plan is billed monthly only.",
  not_purchasable: "This plan isn't available to buy yet. You can continue with Free.",
  billing_v2_disabled: "Card and UPI checkout isn't switched on yet. You can continue with Free and upgrade later.",
  authorisation_required: "Tick the authorisation to continue.",
  advice_ack_required: "Confirm you understand this isn't investment advice.",
  data_ack_required: "Confirm you've read how your data is used.",
  invalid_spend_cap: "Enter a monthly limit between $1 and $100,000.",
  step_not_reached: "Finish the earlier steps first.",
};
const errText = (code: string | undefined) => (code && ERRORS[code]) || "Something went wrong. Your progress is saved — try again.";

const usd = (n: number, dp = 0) => `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const int = (n: number) => n.toLocaleString("en-US");
const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

async function post(path: string, body: unknown): Promise<{ ok: boolean; data?: OB & { checkoutUrl?: string }; error?: string }> {
  try {
    const r = await fetch(`/api/console/me/onboarding/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as { ok: boolean; data?: OB; error?: string };
  } catch {
    return { ok: false, error: "network" };
  }
}

function Check({ checked, onChange, children, required }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--sl-radius)] border border-sl-border p-3.5 hover:border-sl-border-strong">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-required={required || undefined} className="mt-0.5 size-4 shrink-0 accent-[var(--sl-accent)]" />
      <span className="text-[15px] leading-snug text-sl-text">{children}</span>
    </label>
  );
}

const link = "underline underline-offset-2 hover:text-sl-accent";

export function Onboarding({ initial, catalog, country, returned }: { initial: OB; catalog: PlanCatalog | null; country: string | null; returned: boolean }) {
  const router = useRouter();
  const [ob, setOb] = useState<OB>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const paid = ob.itemId ? ob.itemId !== "free" : true;
  const steps = visibleSteps(ob.legacy, paid);
  const current = stepIndex(ob.step, ob.legacy, paid);

  async function submit(path: string, body: unknown) {
    setBusy(true);
    setErr(null);
    const r = await post(path, body);
    setBusy(false);
    if (!r.ok || !r.data) { setErr(errText(r.error)); return null; }
    if (r.data.checkoutUrl) { window.location.href = r.data.checkoutUrl; return null; }
    setOb(r.data);
    window.scrollTo({ top: 0 });
    if (r.data.step === "done") router.push(r.data.firstTask && r.data.firstTask !== "explore" ? `/?task=${r.data.firstTask}` : "/");
    return r.data;
  }

  const error = err && <p role="alert" className="mt-4 rounded-[var(--sl-radius)] border border-sl-warn/40 bg-sl-warn/10 px-3 py-2 text-[14px] text-sl-text">{err}</p>;

  return (
    <div>
      <Stepper steps={steps} current={current} />
      {ob.step === "account" && <AccountStep ob={ob} busy={busy} onSubmit={(b) => submit("account", b)} error={error} />}
      {ob.step === "name" && <NameStep ob={ob} busy={busy} onSubmit={(b) => submit("name", b)} onBack={() => submit("back", { to: "account" })} error={error} />}
      {ob.step === "use" && <UseStep ob={ob} busy={busy} onSubmit={(b) => submit("use", b)} onBack={() => submit("back", { to: "name" })} error={error} />}
      {ob.step === "plan" && <PlanStep ob={ob} catalog={catalog} country={country} busy={busy} onSubmit={(b) => submit("plan", b)} onBack={() => submit("back", { to: "use" })} error={error} />}
      {ob.step === "review" && <ReviewStep ob={ob} catalog={catalog} country={country} busy={busy} onSubmit={() => submit("review", { authoriseRecurring: true, returnUrl: `${location.origin}/welcome?checkout=done` })} onBack={() => submit("back", { to: "plan" })} error={error} />}
      {ob.step === "payment" && <PaymentStep ob={ob} returned={returned} onUpdate={setOb} onBack={() => submit("back", { to: "plan" })} error={error} />}
      {ob.step === "safety" && <SafetyStep ob={ob} busy={busy} onSubmit={(b) => submit("safety", b)} error={error} />}
    </div>
  );
}

function AccountStep({ ob, busy, onSubmit, error }: { ob: OB; busy: boolean; onSubmit: (b: object) => void; error: React.ReactNode }) {
  const [terms, setTerms] = useState(false);
  const [age, setAge] = useState(false);
  const [dpdp, setDpdp] = useState(false);
  const [updates, setUpdates] = useState(false);
  const d = ob.documents;
  return (
    <FlowCard title="Create your account" lede={ob.email ? <>Signed in as <span className="text-sl-text [overflow-wrap:anywhere]">{ob.email}</span>.</> : undefined}>
      <div className="space-y-2">
        <Check checked={terms} onChange={setTerms} required>
          I agree to the <a className={link} href={d.terms.url} target="_blank" rel="noopener">Terms of Service</a> and the <a className={link} href={d["acceptable-use"].url} target="_blank" rel="noopener">Acceptable Use Policy</a>.
        </Check>
        <Check checked={age} onChange={setAge} required>I&apos;m 18 or older.</Check>
        <Check checked={dpdp} onChange={setDpdp} required>
          I consent to Satelink processing my personal data as set out in the <a className={link} href={d.privacy.url} target="_blank" rel="noopener">privacy notice</a>.
        </Check>
        <details className="rounded-[var(--sl-radius)] border border-sl-border px-3.5 py-2.5 text-[14px] text-sl-text-muted">
          <summary className="cursor-pointer text-sl-text">What this consent covers</summary>
          <dl className="mt-2 space-y-2">
            <div><dt className="text-sl-text">What we collect</dt><dd>Your name and email; API usage (requests, keys used, timestamps); IP address and browser; payment status from Dodo — never full card numbers.</dd></div>
            <div><dt className="text-sl-text">Why</dt><dd>To run, meter and bill the service, keep it secure, and meet legal obligations.</dd></div>
            <div><dt className="text-sl-text">Your rights</dt><dd>Withdraw consent, get a copy, correct or erase your data — from Settings, or through the Grievance Officer named in the <a className={link} href={d.privacy.url} target="_blank" rel="noopener">privacy notice</a>.</dd></div>
          </dl>
        </details>
        <Check checked={updates} onChange={setUpdates}>Email me product updates and new features. <span className="text-sl-text-subtle">(Optional)</span></Check>
      </div>
      <p className="mt-3 text-[12px] text-sl-text-subtle">Terms v{d.terms.version} · Acceptable Use v{d["acceptable-use"].version} · Privacy notice v{d.privacy.version}</p>
      {error}
      <div className="mt-6 flex justify-end">
        <button type="button" className={primaryBtn} disabled={busy || !terms || !age || !dpdp} onClick={() => onSubmit({ termsAup: terms, age18: age, dpdp, productUpdates: updates })}>Create account</button>
      </div>
    </FlowCard>
  );
}

function NameStep({ ob, busy, onSubmit, onBack, error }: { ob: OB; busy: boolean; onSubmit: (b: object) => void; onBack: () => void; error: React.ReactNode }) {
  const [name, setName] = useState(ob.displayName);
  return (
    <FlowCard title="What should we call you?" lede="From your sign-in profile — change it if you like.">
      <label className="block text-[14px] text-sl-text" htmlFor="ob-name">Your name</label>
      <input id="ob-name" className={`${field} mt-1.5`} value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      {error}
      <div className="mt-6 flex justify-between gap-2">
        <button type="button" className={secondaryBtn} onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className={primaryBtn} disabled={busy || !name.trim()} onClick={() => onSubmit({ name })}>Continue</button>
      </div>
    </FlowCard>
  );
}

function UseStep({ ob, busy, onSubmit, onBack, error }: { ob: OB; busy: boolean; onSubmit: (b: object) => void; onBack: () => void; error: React.ReactNode }) {
  const [use, setUse] = useState(ob.useCase ?? "");
  const [task, setTask] = useState(ob.firstTask ?? "");
  const tasks = use ? USE_CASE_TASKS[use] ?? [] : [];
  return (
    <FlowCard title="What will you use Satelink for?" lede="We'll suggest a plan and put the right things first on your home screen.">
      <label className="block text-[14px] text-sl-text" htmlFor="ob-use">What will you use Satelink for?</label>
      <select id="ob-use" className={`${field} mt-1.5`} value={use} onChange={(e) => { setUse(e.target.value); setTask(""); }}>
        <option value="" disabled>Choose one</option>
        {Object.entries(USE_CASE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {use && (
        <fieldset className="mt-6 space-y-2">
          <legend className="mb-2 text-[14px] text-sl-text">Pick a first task</legend>
          {tasks.map((t) => <Choice key={t} name="task" value={t} checked={task === t} onChange={setTask} title={TASKS[t].title} detail={TASKS[t].body} />)}
          <Choice name="task" value="explore" checked={task === "explore"} onChange={setTask} title="I'll explore myself" />
        </fieldset>
      )}
      {error}
      <div className="mt-6 flex justify-between gap-2">
        <button type="button" className={secondaryBtn} onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className={primaryBtn} disabled={busy || !use || !task} onClick={() => onSubmit({ useCase: use, firstTask: task })}>Continue</button>
      </div>
    </FlowCard>
  );
}

function yearlyOf(catalog: PlanCatalog, id: string) {
  return catalog.plans.find((p) => p.basePlanId === id && p.interval === "year") ?? null;
}
function renewalLine(p: Plan) {
  if (p.kind === "free") return "No card needed. Upgrade any time.";
  if (p.intro) return `${p.intro.copy.replace(/\.$/, "")} until you cancel.`;
  return p.interval === "year" ? `Renews yearly at ${usd(p.priceUsd)} until you cancel.` : `Renews monthly at ${usd(p.priceUsd)} until you cancel.`;
}

function PlanStep({ ob, catalog, country, busy, onSubmit, onBack, error }: { ob: OB; catalog: PlanCatalog | null; country: string | null; busy: boolean; onSubmit: (b: object) => void; onBack: () => void; error: React.ReactNode }) {
  const [period, setPeriod] = useState<"month" | "year">(ob.period ?? "month");
  const base = useMemo(() => (catalog?.plans ?? []).filter((p) => !p.basePlanId), [catalog]);
  const maxSave = useMemo(() => {
    if (!catalog) return 0;
    return Math.max(0, ...base.map((p) => { const y = yearlyOf(catalog, p.id); return y ? Math.round((1 - y.priceUsd / (p.priceUsd * 12)) * 100) : 0; }));
  }, [catalog, base]);
  if (!catalog) return <FlowCard title="Choose your plan"><p className="text-sl-text-muted">Plans couldn&apos;t be loaded. Refresh in a moment — your progress is saved.</p></FlowCard>;
  const india = country === "IN";

  return (
    <section aria-labelledby="plan-h">
      <h1 id="plan-h" className="font-sl-display text-[1.75rem] font-normal leading-tight text-sl-text">Choose your plan</h1>
      <p className="mt-2 text-[15px] text-sl-text-muted">Plans cover Trading Intelligence. Blockchain RPC and x402 are paid per call with crypto credits on every plan.</p>
      <div role="group" aria-label="Billing period" className="mt-5 inline-flex rounded-[var(--sl-radius)] border border-sl-border p-1">
        {(["month", "year"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={period === v} onClick={() => setPeriod(v)} className={`h-9 rounded-[calc(var(--sl-radius)-2px)] px-4 text-[14px] ${period === v ? "bg-sl-accent text-sl-accent-ink" : "text-sl-text hover:bg-sl-surface-hover"}`}>
            {v === "month" ? "Monthly" : maxSave > 0 ? `Yearly · save up to ${maxSave}%` : "Yearly"}
          </button>
        ))}
      </div>
      {india && <p className="mt-3 text-[13px] text-sl-text-muted">In India you pay in rupees, GST included — Dodo Payments shows the rupee amount at checkout.</p>}
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {base.map((b) => {
          const y = period === "year" ? yearlyOf(catalog, b.id) : null;
          const shown = y ?? b;
          const monthlyOnly = period === "year" && b.kind !== "free" && !y;
          const recommended = ob.recommendedPlan === b.id;
          const saving = y ? b.priceUsd * 12 - y.priceUsd : 0;
          const available = shown.kind === "free" || shown.purchasable;
          return (
            <li key={b.id} className={`flex flex-col rounded-[var(--sl-radius-lg)] border bg-sl-surface p-5 ${recommended ? "border-sl-accent" : "border-sl-border"}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[17px] font-medium text-sl-text">{b.name}</h2>
                {recommended && <span className="rounded-full bg-sl-accent-soft px-2.5 py-0.5 text-[12px] font-medium text-sl-accent">Recommended for you</span>}
              </div>
              <p className="mt-2 text-sl-text">
                {india && shown.inrPrice ? (
                  <><span className="text-[1.75rem] font-medium">{inr(shown.inrPrice)}</span> <span className="text-sl-text-muted">{shown.kind === "free" ? "" : shown.interval === "year" ? "/ year" : "/ month"} incl. GST</span></>
                ) : (
                  <><span className="text-[1.75rem] font-medium">{usd(shown.priceUsd)}</span> <span className="text-sl-text-muted">{shown.kind === "free" ? "forever" : shown.interval === "year" ? "/ year" : "/ month"}</span></>
                )}
              </p>
              {y && saving > 0 && <p className="text-[13px] font-medium text-sl-text">Save {usd(saving)} a year vs monthly</p>}
              {monthlyOnly && <p className="text-[13px] text-sl-text-muted">Billed monthly only</p>}
              <ul className="mt-3 flex-1 space-y-1 text-[14px] text-sl-text-muted">
                <li>{int(shown.allowance.weeklyTiRequests)} market-data requests a week</li>
                <li>Up to {int(shown.allowance.sessionTiRequests)} per {shown.allowance.sessionHours}-hour session</li>
                {shown.limits && <li>{shown.limits.api_keys} API {shown.limits.api_keys === 1 ? "key" : "keys"}</li>}
              </ul>
              <p className="mt-3 text-[13px] text-sl-text-muted">{renewalLine(shown)}</p>
              <button
                type="button"
                className={`${secondaryBtn} mt-4 w-full`}
                disabled={busy || !available}
                onClick={() => onSubmit({ planId: b.id, period: y ? "year" : "month" })}
              >
                {b.kind === "free" ? "Continue with Free" : available ? `Choose ${b.name}` : "Not available yet"}
              </button>
            </li>
          );
        })}
      </ul>
      {error}
      <div className="mt-6"><button type="button" className={secondaryBtn} onClick={onBack} disabled={busy}>Back</button></div>
    </section>
  );
}

function ReviewStep({ ob, catalog, country, busy, onSubmit, onBack, error }: { ob: OB; catalog: PlanCatalog | null; country: string | null; busy: boolean; onSubmit: () => void; onBack: () => void; error: React.ReactNode }) {
  const [authorised, setAuthorised] = useState(false);
  const item = catalog?.plans.find((p) => p.id === ob.itemId);
  if (!item) return <FlowCard title="Review"><p className="text-sl-text-muted">Plans couldn&apos;t be loaded. Refresh in a moment — your progress is saved.</p></FlowCard>;
  const india = country === "IN";
  const yearly = item.interval === "year";
  const today = item.intro ? item.intro.amountUsd : item.priceUsd;
  const renew = new Date();
  if (item.intro) renew.setDate(renew.getDate() + item.intro.days);
  else if (yearly) renew.setFullYear(renew.getFullYear() + 1);
  else renew.setMonth(renew.getMonth() + 1);
  const per = yearly ? "year" : "month";
  const inrShown = india && item.inrPrice && !item.intro ? item.inrPrice : null;
  const rows: [string, string][] = [
    ["Plan", `${item.name}${yearly ? " (yearly)" : ""}`],
    ["Billing period", yearly ? "Yearly" : "Monthly"],
    ["Subtotal", inrShown ? inr(inrShown) : `${usd(today, 2)}${item.intro ? " (first month)" : ""}`],
    ["Tax", inrShown ? `GST included (${inr(Math.round(inrShown - inrShown / 1.18))})` : india ? "GST included — shown in rupees by Dodo at checkout" : "Calculated by Dodo Payments at checkout, based on where you are"],
    ["Total today", inrShown ? inr(inrShown) : india ? `${usd(today, 2)}, charged in rupees incl. GST` : `${usd(today, 2)} + applicable tax`],
    ["Next renewal", `${longDate(renew)} (about) — ${usd(item.priceUsd, 2)}${india ? "" : " + tax"} per ${per}`],
  ];
  return (
    <FlowCard title="Review and pay" lede="Payment is handled by Dodo Payments, our Merchant of Record. You'll finish on their secure page.">
      <dl className="divide-y divide-sl-border rounded-[var(--sl-radius)] border border-sl-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-[14px] text-sl-text-muted">{k}</dt>
            <dd className={`text-[15px] text-sl-text sm:text-right ${k === "Total today" ? "font-medium" : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[14px] text-sl-text-muted">
        Cancel anytime from Billing. Cancellation takes effect at the end of the period you&apos;ve paid for, and you keep access until then. No partial refunds for unused time unless the law requires one (<a className={link} href={ob.documents["billing-policy"].url} target="_blank" rel="noopener">billing policy</a>).
      </p>
      <div className="mt-4">
        <Check checked={authorised} onChange={setAuthorised} required>
          I authorise recurring charges of {usd(item.priceUsd, 2)} per {per}{india ? "" : " plus tax"} to my payment method, through Dodo Payments, until I cancel.
        </Check>
      </div>
      {error}
      <div className="mt-6 flex justify-between gap-2">
        <button type="button" className={secondaryBtn} onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className={primaryBtn} disabled={busy || !authorised} onClick={onSubmit}>Continue to payment</button>
      </div>
    </FlowCard>
  );
}

function PaymentStep({ ob, returned, onUpdate, onBack, error }: { ob: OB; returned: boolean; onUpdate: (o: OB) => void; onBack: () => void; error: React.ReactNode }) {
  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    if (ob.payment !== "pending") return;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      const r = await fetch("/api/console/onboarding", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (r?.ok && r.data) { if (r.data.step !== "payment" || r.data.payment !== "pending") { clearInterval(t); onUpdate(r.data); } }
      if (n >= 60) { clearInterval(t); setWaitedOut(true); }
    }, 3000);
    return () => clearInterval(t);
  }, [ob.payment, onUpdate]);

  if (ob.payment === "failed") {
    return (
      <FlowCard title="Payment didn't go through" lede="Nothing was charged for this plan. You can try again or pick another option.">
        {error}
        <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={primaryBtn} onClick={onBack}>Choose a plan again</button></div>
      </FlowCard>
    );
  }
  return (
    <FlowCard title={returned ? "Confirming your payment" : "Waiting for your payment"}>
      <div role="status" aria-live="polite" className="flex items-start gap-3">
        <span aria-hidden className="mt-1.5 inline-block size-2.5 animate-pulse rounded-full bg-sl-accent" />
        <p className="text-[15px] text-sl-text-muted">
          {waitedOut
            ? "This is taking longer than usual. Your plan appears as soon as Dodo confirms the payment — you can leave this page and come back."
            : returned
              ? "Pending — Dodo Payments tells us when the payment clears, usually within a minute. This page updates by itself."
              : "Pending — we haven't heard from Dodo Payments yet. If you closed the checkout, you can go back and choose again."}
        </p>
      </div>
      {error}
      <div className="mt-6"><button type="button" className={secondaryBtn} onClick={onBack}>Choose a different plan</button></div>
    </FlowCard>
  );
}

function SafetyStep({ ob, busy, onSubmit, error }: { ob: OB; busy: boolean; onSubmit: (b: object) => void; error: React.ReactNode }) {
  const [advice, setAdvice] = useState(false);
  const [capOn, setCapOn] = useState(true);
  const [cap, setCap] = useState(String(ob.spendCapDefaultUsd));
  const [data, setData] = useState(false);
  const capNum = Number(cap);
  const capOk = !capOn || (capNum > 0 && capNum <= 100000);
  const card = "rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5";
  return (
    <section aria-labelledby="safety-h">
      <h1 id="safety-h" className="font-sl-display text-[1.75rem] font-normal leading-tight text-sl-text">Before your first request</h1>
      <p className="mt-2 text-[15px] text-sl-text-muted">Three things worth knowing. You can change any of them later in Settings.</p>
      <div className="mt-5 grid gap-3">
        <section aria-labelledby="c1" className={card}>
          <h2 id="c1" className="flex items-center gap-2 text-[17px] font-medium text-sl-text"><LineChart aria-hidden className="size-5 text-sl-accent" /> Not investment advice</h2>
          <p className="mt-2 text-[14px] text-sl-text-muted">Satelink returns statistics derived from public market data. Nothing it returns is a recommendation to buy or sell, and you&apos;re responsible for the decisions you — and any software using your keys — make with it.</p>
          <div className="mt-3"><Check checked={advice} onChange={setAdvice} required>I understand Satelink is not investment advice.</Check></div>
        </section>
        <section aria-labelledby="c2" className={card}>
          <h2 id="c2" className="flex items-center gap-2 text-[17px] font-medium text-sl-text"><Wallet aria-hidden className="size-5 text-sl-accent" /> Spend protection</h2>
          <p className="mt-2 text-[14px] text-sl-text-muted">A monthly limit on what your keys can spend from credits. When it&apos;s reached, paid calls are refused until next month or until you raise it. It doesn&apos;t affect your plan&apos;s renewal.</p>
          <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
            <span className="text-[15px] text-sl-text">Monthly spending limit</span>
            <input type="checkbox" role="switch" aria-checked={capOn} checked={capOn} onChange={(e) => setCapOn(e.target.checked)} className="size-5 accent-[var(--sl-accent)]" />
          </label>
          {capOn && (
            <div className="mt-3">
              <label htmlFor="ob-cap" className="block text-[14px] text-sl-text">Monthly limit in US dollars</label>
              <input id="ob-cap" inputMode="decimal" className={`${field} mt-1.5 max-w-[12rem]`} value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} aria-invalid={!capOk || undefined} />
            </div>
          )}
        </section>
        <section aria-labelledby="c3" className={card}>
          <h2 id="c3" className="flex items-center gap-2 text-[17px] font-medium text-sl-text"><ShieldCheck aria-hidden className="size-5 text-sl-accent" /> Your data</h2>
          <p className="mt-2 text-[14px] text-sl-text-muted">We keep your account details, API usage and payment status — never card numbers. Download or delete everything from Settings whenever you like. Details are in the <a className={link} href={ob.documents.privacy.url} target="_blank" rel="noopener">privacy notice</a>.</p>
          <div className="mt-3"><Check checked={data} onChange={setData} required>I&apos;ve read how Satelink uses my data.</Check></div>
        </section>
      </div>
      {error}
      <div className="mt-6 flex justify-end">
        <button type="button" className={primaryBtn} disabled={busy || !advice || !data || !capOk} onClick={() => onSubmit({ adviceAck: advice, dataAck: data, spendCap: capOn ? { enabled: true, amountUsd: capNum } : { enabled: false } })}>Go to my console</button>
      </div>
    </section>
  );
}
