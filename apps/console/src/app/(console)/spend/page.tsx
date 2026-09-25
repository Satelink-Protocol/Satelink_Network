import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { accountsEnabled } from "@/lib/account";
import { loadCatalog, loadKeys, loadPlan, loadSpend, usd } from "@/lib/v2";
import { BarList, Meter } from "@/components/v2/charts";
import { Help } from "@/components/v2/Help";

export const metadata: Metadata = { title: "What I've spent" };

// "See what I've spent" — plain summary: this month, per agent, what's left,
// when it resets. Every figure is read from the API for this account.
export default async function SpendPage() {
  if (!accountsEnabled()) redirect("/usage");
  const [spend, plan, keys, catalog] = await Promise.all([loadSpend(), loadPlan(), loadKeys(), loadCatalog()]);
  const label = (id: number) => (keys.ok ? keys.data.find((k) => k.id === id)?.label : null) ?? `Key ${id}`;
  const credits = keys.ok ? keys.data.reduce((a, k) => a + k.balanceUsdt, 0) : null;
  const p = plan.ok ? plan.data : null;
  const planName = p ? catalog?.plans.find((x) => x.id === p.plan.id)?.name ?? p.plan.id : null;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-sl-display text-[2rem] font-normal leading-tight text-sl-text">What you&apos;ve spent</h1>
        <p className="mt-1 text-[15px] text-sl-text-muted">This month, by agent — and what you have left.</p>
      </header>
      <section aria-label="This month" className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-4">
          <p className="text-[13px] text-sl-text-muted">Spent this month<Help term="crypto credits" label="From credits" /></p>
          <p className="tnum mt-1 text-2xl text-sl-text">{spend.ok ? usd(spend.data.monthSpentUsdt, 4) : "Unavailable"}</p>
          <p className="mt-1 text-[12px] text-sl-text-subtle">{spend.ok ? `${spend.data.monthRequests.toLocaleString()} paid requests` : "Couldn't load spending."}</p>
        </div>
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-4">
          <p className="text-[13px] text-sl-text-muted">Credits left</p>
          <p className="tnum mt-1 text-2xl text-sl-text">{credits === null ? "Unavailable" : usd(credits, 4)}</p>
          <p className="mt-1 text-[12px] text-sl-text-subtle">Across all your keys. <Link className="underline" href="/billing/add">Add money</Link></p>
        </div>
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-4">
          <p className="text-[13px] text-sl-text-muted">Credit pack left</p>
          <p className="tnum mt-1 text-2xl text-sl-text">{p ? `${p.packBalanceUu.toLocaleString()} UU` : "Unavailable"}</p>
          <p className="mt-1 text-[12px] text-sl-text-subtle">{p ? `≈ ${Math.floor(p.packBalanceUu / 10).toLocaleString()} market-data requests` : ""}</p>
        </div>
      </section>
      {p && (
        <section aria-label="Plan allowance" className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
          <p className="text-[15px] text-sl-text">{planName} plan allowance</p>
          <div className="mt-4 space-y-4">
            <Meter label="This session" used={p.windows.session.usedUu} cap={p.windows.session.capUu} hint={p.windows.session.resetsAt ? `Frees up from ${new Date(p.windows.session.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (rolling ${p.windows.session.hours} hours).` : `Rolling ${p.windows.session.hours}-hour window.`} />
            <Meter label="This week" used={p.windows.weekly.usedUu} cap={p.windows.weekly.capUu} hint={`Resets ${new Date(p.windows.weekly.resetsAt).toLocaleString([], { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} (${p.windows.weekly.timezone}).`} />
          </div>
        </section>
      )}
      <section aria-label="By agent" className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
        {spend.ok && spend.data.perKey.length > 0 ? (
          <BarList title="Spent this month, by agent (credits)" items={spend.data.perKey.map((k) => ({ label: label(k.id), value: k.monthUsdt })).sort((a, b) => b.value - a.value)} format="usd4" caption="Spending from crypto credits. Plan and pack usage is shown above in UU." />
        ) : (
          <p className="text-sl-text-muted">No agents yet. <Link className="text-sl-accent underline" href="/agents/new">Give your software access</Link> to get started.</p>
        )}
      </section>
    </div>
  );
}
