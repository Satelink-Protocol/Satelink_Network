"use client";
// Simple-mode task flow: "Add money". A plan or a credit pack (Dodo checkout,
// card/UPI) — or a USDT deposit on Polygon to a key. Prices, allowances and
// the intro copy come from the PlanCatalog; nothing is hard-coded here.
import { useState } from "react";
import { Choice, Done, FlowCard, Stepper, field, primaryBtn, secondaryBtn } from "./Flow";
import { Help } from "./Help";
import type { AccountPlan, PlanCatalog } from "@/lib/v2-shared";

type KeyOpt = { id: number; label: string; hint: string; balanceUsdt: number };
const STEPS = ["How", "Choose", "Pay", "Done"];

export function AddMoneyFlow({ catalog, keys, plan, returned }: { catalog: PlanCatalog | null; keys: KeyOpt[]; plan: AccountPlan | null; returned: boolean }) {
  const [step, setStep] = useState(returned ? 3 : 0);
  const [how, setHow] = useState<"plan" | "pack" | "usdt" | "">("");
  const [item, setItem] = useState("");
  const [keyId, setKeyId] = useState<number | null>(keys[0]?.id ?? null);
  const [info, setInfo] = useState<{ address?: string; network?: string; token_address?: string } | null>(null);
  const [tx, setTx] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);

  if (!catalog) return <FlowCard title="Add money"><p className="text-sl-text-muted">Prices couldn't be loaded. Refresh in a moment.</p></FlowCard>;
  const plans = catalog.plans.filter((p) => p.kind === "subscription");
  const current = plan?.plan.id;

  async function checkout() {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/console/me/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item, returnUrl: `${location.origin}/billing/add?checkout=done` }) });
    const j = await r.json().catch(() => null);
    setBusy(false);
    if (j?.ok && j.data?.checkoutUrl) { window.location.href = j.data.checkoutUrl; return; }
    setErr(j?.error === "billing_v2_disabled" ? "Card and UPI checkout isn't switched on yet. USDT works today." : j?.error === "not_purchasable" ? "This option isn't available to buy yet." : "Checkout couldn't start. Try again.");
  }

  async function loadInfo(id: number) {
    setInfo(null);
    const r = await fetch(`/api/console/deposit-info?keyId=${id}`);
    const j = await r.json().catch(() => null);
    setInfo(j?.ok ? j : null);
  }

  async function claim() {
    if (!keyId) return;
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/console/me/keys/${keyId}/deposit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txHash: tx.trim() }) });
    const j = await r.json().catch(() => null);
    setBusy(false);
    if (r.ok && j?.ok) { setClaimed(`${Number(j.credited_usdt ?? j.amount_usdt ?? 0).toFixed(2)} USDT`); setStep(3); }
    else setErr(j?.message || j?.error || "We couldn't verify that transaction yet. It can take a few minutes to confirm.");
  }

  if (step === 3) {
    return (
      <div className="mx-auto max-w-2xl">
        <Stepper steps={STEPS} current={3} />
        <FlowCard title={returned ? "Thanks — payment received" : "Done"}>
          <Done
            title={claimed ? `${claimed} added` : "Your payment is being confirmed"}
            body={claimed ? "Credits are on your key now." : "Dodo confirms the payment to us in the background — your plan or pack appears on the Billing page within a minute. A receipt is on its way by email."}
            next={[{ label: "See billing", href: "/billing" }, { label: "Get market data", href: "/data" }]}
          />
        </FlowCard>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Stepper steps={STEPS} current={step} />
      {step === 0 && (
        <FlowCard title="How would you like to add money?">
          <fieldset className="space-y-2">
            <legend className="sr-only">Payment option</legend>
            <Choice name="how" value="plan" checked={how === "plan"} onChange={(v) => setHow(v as "plan")} title="A monthly plan" detail="A weekly allowance of market data, renewed monthly. Card or UPI." />
            <Choice name="how" value="pack" checked={how === "pack"} onChange={(v) => setHow(v as "pack")} title="A credit pack" detail="Pay once, use for market data whenever you like. Doesn't expire. Card or UPI." />
            <Choice name="how" value="usdt" checked={how === "usdt"} onChange={(v) => setHow(v as "usdt")} title="USDT on Polygon" detail="Crypto credits for blockchain RPC and market data beyond your plan." />
          </fieldset>
          <div className="mt-6 flex justify-end"><button type="button" className={primaryBtn} disabled={!how} onClick={() => { setStep(1); if (how === "usdt" && keyId) loadInfo(keyId); }}>Continue</button></div>
        </FlowCard>
      )}
      {step === 1 && how === "plan" && (
        <FlowCard title="Choose a plan" lede={<>Allowances are counted in UU<Help term="UU" label="What's UU?" /> — one market-data request is 10 UU.</>}>
          <fieldset className="space-y-2">
            <legend className="sr-only">Plans</legend>
            {plans.map((p) => (
              <Choice key={p.id} name="plan" value={p.id} checked={item === p.id} onChange={setItem}
                title={`${p.name} — ${p.intro ? `$${p.intro.amountUsd} first month, then ` : ""}$${p.priceUsd}/month${current === p.id ? " (your plan)" : ""}`}
                detail={`${p.intro ? p.intro.copy + " " : ""}About ${p.allowance.weeklyTiRequests.toLocaleString()} market-data requests a week, up to ${p.allowance.sessionTiRequests.toLocaleString()} per ${p.allowance.sessionHours} hours.${p.purchasable ? "" : " Not available to buy yet."}`} />
            ))}
          </fieldset>
          <div className="mt-6 flex justify-between">
            <button type="button" className={secondaryBtn} onClick={() => setStep(0)}>Back</button>
            <button type="button" className={primaryBtn} disabled={!item} onClick={() => setStep(2)}>Continue</button>
          </div>
        </FlowCard>
      )}
      {step === 1 && how === "pack" && (
        <FlowCard title="Choose a credit pack">
          <fieldset className="space-y-2">
            <legend className="sr-only">Packs</legend>
            {catalog.packs.map((k) => (
              <Choice key={k.id} name="pack" value={k.id} checked={item === k.id} onChange={setItem}
                title={`$${k.priceUsd}`} detail={`${k.grantUu.toLocaleString()} UU — about ${k.tiRequests.toLocaleString()} market-data requests.${k.purchasable ? "" : " Not available to buy yet."}`} />
            ))}
          </fieldset>
          <div className="mt-6 flex justify-between">
            <button type="button" className={secondaryBtn} onClick={() => setStep(0)}>Back</button>
            <button type="button" className={primaryBtn} disabled={!item} onClick={() => setStep(2)}>Continue</button>
          </div>
        </FlowCard>
      )}
      {step === 1 && how === "usdt" && (
        <FlowCard title="Which key should receive it?" lede="Crypto credits belong to one key.">
          {keys.length === 0 ? <p className="text-sl-text-muted">Create a key first on the Agents page.</p> : (
            <label className="block">
              <span className="mb-1 block text-[13px] text-sl-text-muted">Key<Help term="crypto credits" label="What are crypto credits?" /></span>
              <select className={field} value={keyId ?? ""} onChange={(e) => { setKeyId(Number(e.target.value)); loadInfo(Number(e.target.value)); }}>
                {keys.map((k) => <option key={k.id} value={k.id}>{k.label} ({k.hint}) — ${k.balanceUsdt.toFixed(2)}</option>)}
              </select>
            </label>
          )}
          <div className="mt-6 flex justify-between">
            <button type="button" className={secondaryBtn} onClick={() => setStep(0)}>Back</button>
            <button type="button" className={primaryBtn} disabled={!keyId} onClick={() => setStep(2)}>Continue</button>
          </div>
        </FlowCard>
      )}
      {step === 2 && how !== "usdt" && (
        <FlowCard title="Review and pay" lede="You'll finish on Dodo Payments' secure page (card or UPI), then come back here.">
          {(() => {
            const p = plans.find((x) => x.id === item);
            const k = catalog.packs.find((x) => x.id === item);
            return (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
                <dt className="text-sl-text-muted">You're buying</dt><dd className="text-sl-text">{p ? `${p.name} plan` : `Credit pack $${k?.priceUsd}`}</dd>
                <dt className="text-sl-text-muted">Today</dt><dd className="text-sl-text">${p?.intro ? p.intro.amountUsd : (p?.priceUsd ?? k?.priceUsd)}</dd>
                {p && <><dt className="text-sl-text-muted">Then</dt><dd className="text-sl-text">${p.priceUsd} every month until you cancel</dd></>}
              </dl>
            );
          })()}
          <p className="mt-3 text-[12px] text-sl-text-subtle">Dodo Payments is the merchant of record. Plan and pack value pays for market data only; RPC is paid with crypto credits.</p>
          {err && <p role="alert" className="mt-3 text-sl-down">{err}</p>}
          <div className="mt-6 flex justify-between">
            <button type="button" className={secondaryBtn} onClick={() => setStep(1)}>Back</button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={checkout}>{busy ? "Opening checkout…" : "Continue to payment"}</button>
          </div>
        </FlowCard>
      )}
      {step === 2 && how === "usdt" && (
        <FlowCard title="Send USDT, then paste the transaction" lede="Polygon network only. Any amount from $0.50.">
          {info?.address ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
              <dt className="text-sl-text-muted">Send to</dt><dd className="break-all font-mono text-sl-text">{info.address}</dd>
              <dt className="text-sl-text-muted">Network</dt><dd className="text-sl-text">{info.network ?? "Polygon"}</dd>
              <dt className="text-sl-text-muted">Token</dt><dd className="break-all font-mono text-sl-text">USDT {info.token_address}</dd>
            </dl>
          ) : <p className="text-sl-text-muted" role="status">Loading deposit details…</p>}
          <label className="mt-5 block">
            <span className="mb-1 block text-[13px] text-sl-text-muted">Transaction hash</span>
            <input className={`${field} font-mono`} value={tx} onChange={(e) => setTx(e.target.value)} placeholder="0x…" />
          </label>
          {err && <p role="alert" className="mt-3 text-sl-down">{err}</p>}
          <div className="mt-6 flex justify-between">
            <button type="button" className={secondaryBtn} onClick={() => setStep(1)}>Back</button>
            <button type="button" className={primaryBtn} disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(tx.trim())} onClick={claim}>{busy ? "Checking…" : "Add to my key"}</button>
          </div>
        </FlowCard>
      )}
    </div>
  );
}
