import type { Metadata } from "next";
import { Badge, Empty, ErrorNote, Kpi, NeedsKey, PageHeader, Panel, Table } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { loadKey } from "@/lib/data";
import { date, int, shortHash, usd } from "@/lib/format";
import { getActiveKey } from "@/lib/keys";
import { accountsEnabled, me } from "@/lib/account";
import { loadCatalog, loadKeys, loadPlan, usd as usdV2, type PlanCatalog, type AccountPlan } from "@/lib/v2";
import { Meter } from "@/components/v2/charts";
import Link from "next/link";

export const metadata: Metadata = { title: "Billing" };

const WEB = "https://satelink.network";

type DepositInfo = { ok: true; current_tier: string; current_limit: number; credits_balance: number; total_deposited: number };
type Plans = { ok: true; plans: { id: string; name: string; price: { monthly: number; yearly: number }; includedCalls: number; overagePerCall: number | null; apiKeys: number }[] };

export default async function BillingPage() {
  if (accountsEnabled()) return <BillingV2 />;
  const active = await getActiveKey();
  const plans = await apiFetch<Plans>("/v1/plans", { revalidate: 300 });
  if (!active) return (<><PageHeader title="Billing" /><NeedsKey /></>);
  const [info, d] = await Promise.all([apiFetch<DepositInfo>("/api/keys/deposit-info", { key: active.k }), loadKey(active.k)]);
  const s = d.summary;

  return (
    <>
      <PageHeader
        title="Billing"
        lede={`Plan, balances and payments for ${active.label}.`}
        actions={
          <>
            <a href={`${WEB}/checkout?plan=starter`} className="h-8 rounded bg-sl-accent px-3 py-2 text-xs font-semibold text-sl-accent-ink">Buy credit pack</a>
            <a href={`${WEB}/pricing`} className="h-8 rounded border border-sl-border px-3 py-2 text-xs">Compare plans</a>
          </>
        }
      />
      {!info.ok && !s ? (
        <ErrorNote what="billing details" />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Plan" value={s ? <span className="capitalize">{s.plan}</span> : null} hint={s?.subscription?.currentPeriodEnd ? `Renews ${date(s.subscription.currentPeriodEnd)}` : "No renewal — not subscribed"} />
          <Kpi label="Crypto credits" value={info.ok ? usd(info.data.credits_balance, 4) : null} hint="USDT rail · RPC and machine endpoints" />
          <Kpi label="Total deposited" value={info.ok ? `${info.data.total_deposited.toFixed(2)} USDT` : null} />
          <Kpi label="Key tier · daily limit" value={info.ok ? `${info.data.current_tier} · ${int(info.data.current_limit)}` : null} />
        </div>
      )}

      <Panel title="Plans" className="mt-4">
        {plans.ok ? (
          <Table head={["Plan", "Monthly", "Yearly", "Included calls / month", "Overage per call", "API keys", ""]} numeric={[1, 2, 3, 4, 5]}>
            {plans.data.plans.map((p) => (
              <tr key={p.id}>
                <td className="font-medium text-sl-text">{p.name}</td>
                <td className="text-right">{usd(p.price.monthly)}</td>
                <td className="text-right">{usd(p.price.yearly)}</td>
                <td className="text-right">{int(p.includedCalls)}</td>
                <td className="text-right">{p.overagePerCall === null ? "none" : usd(p.overagePerCall, 3)}</td>
                <td className="text-right">{p.apiKeys}</td>
                <td className="text-right">{s?.plan === p.id ? <Badge tone="good">current</Badge> : <a className="text-xs text-sl-accent hover:underline" href={`${WEB}/pricing`}>View</a>}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <ErrorNote what="the plan catalogue" />
        )}
        <p className="mt-2 text-[11px] text-sl-text-subtle">Card and UPI purchases are processed by Dodo Payments (Merchant of Record) and fund Trading Intelligence. The crypto rail (x402 / USDT) is separate and not billed through Dodo.</p>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="USDT deposits (Polygon)">
          {d.deposits === null ? (
            <ErrorNote what="deposits" />
          ) : d.deposits.length === 0 ? (
            <Empty title="No deposits yet" body="Deposits credited to this key appear here with their Polygon transaction." />
          ) : (
            <Table head={["Date", "Transaction", "Amount"]} numeric={[2]}>
              {d.deposits.map((x) => (
                <tr key={x.tx_hash}>
                  <td>{date(x.created_at)}</td>
                  <td><a className="font-mono hover:underline" href={`https://polygonscan.com/tx/${x.tx_hash}`} target="_blank" rel="noopener">{shortHash(x.tx_hash)}</a></td>
                  <td className="text-right">{Number(x.amount_usdt).toFixed(2)} USDT</td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
        <Panel title="Receipts and refunds (Dodo)">
          <Empty title="No card or UPI receipts here yet" body="Dodo sends receipts and invoices by email; a portal link appears here once the Dodo customer-portal endpoint is wired. Refunds follow the refund policy." cta={{ label: "Refund policy", href: `${WEB}/refund` }} />
        </Panel>
      </div>

      <Panel title="Spend controls" className="mt-4">
        <p className="text-sl-text-muted">A credit auto-use toggle and a monthly spend cap need server-side account settings and are not available yet. Crypto credits are only spent by calls made with this key.</p>
      </Panel>
    </>
  );
}

// Console V2 Billing (Pricing V2): everything renders from the PlanCatalog
// (/v2/plans) and the account's plan (/v1/me/plan) — the old "included calls /
// month" table is gone (AUDIT_2026-09-25 D9).
type Deposit = { txHash: string; amountUsdt: number; creditedUsdt: number | null; at: string; key: { label: string; hint: string } };

async function BillingV2() {
  const [catalog, plan, keys, deposits] = await Promise.all([loadCatalog(), loadPlan(), loadKeys(), me<Deposit[]>("/deposits")]);
  const p: AccountPlan | null = plan.ok ? plan.data : null;
  const cat: PlanCatalog | null = catalog;
  const current = p ? cat?.plans.find((x) => x.id === p.plan.id) : null;
  const credits = keys.ok ? keys.data.reduce((a, k) => a + k.balanceUsdt, 0) : null;
  return (
    <>
      <PageHeader title="Billing" lede="Your plan, allowances and balances." actions={<Link href="/billing/add" className="h-8 rounded bg-sl-accent px-3 py-2 text-xs font-semibold text-sl-accent-ink">Add money</Link>} />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Plan" value={current ? current.name : null} hint={p?.subscription?.renewsAt ? `${p.subscription.intro ? "Intro month · " : ""}Renews ${date(p.subscription.renewsAt)}` : p?.plan.status === "on_hold" ? "Payment on hold — update your card" : "No subscription"} />
        <Kpi label="Plan allowance this week" value={p ? `${(p.windows.weekly.capUu - p.windows.weekly.usedUu).toLocaleString()} UU left` : null} hint={p ? `of ${p.windows.weekly.capUu.toLocaleString()} UU` : undefined} />
        <Kpi label="Credit pack" value={p ? `${p.packBalanceUu.toLocaleString()} UU` : null} hint="Dodo-funded · market data only" />
        <Kpi label="Crypto credits" value={credits === null ? null : usdV2(credits, 4)} hint="USDT rail · RPC and machine endpoints" />
      </div>

      {p && (
        <Panel title="Allowance" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Meter label={`Session (rolling ${p.windows.session.hours} h)`} used={p.windows.session.usedUu} cap={p.windows.session.capUu} />
            <Meter label="Week" used={p.windows.weekly.usedUu} cap={p.windows.weekly.capUu} hint={`Resets ${date(p.windows.weekly.resetsAt)} (${p.windows.weekly.timezone})`} />
          </div>
        </Panel>
      )}

      <Panel title={`Plans${cat ? ` · catalog ${cat.version}` : ""}`} className="mt-4">
        {!cat ? <ErrorNote what="the plan catalogue" /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="plan-cards">
            {cat.plans.map((x) => (
              <div key={x.id} className={`rounded-md border p-3 ${current?.id === x.id ? "border-sl-accent" : "border-sl-border"}`} data-plan={x.id}>
                <p className="flex items-center justify-between font-medium text-sl-text">{x.name}{current?.id === x.id && <Badge tone="good">current</Badge>}</p>
                <p className="tnum mt-1 text-lg text-sl-text">{x.kind === "free" ? "$0" : x.intro ? `$${x.intro.amountUsd} → $${x.priceUsd}/mo` : `$${x.priceUsd}/mo`}</p>
                {x.intro && <p className="mt-0.5 text-[11px] text-sl-text-muted">{x.intro.copy}</p>}
                <ul className="mt-2 space-y-0.5 text-[12px] text-sl-text-muted">
                  <li>{x.allowance.weeklyUu.toLocaleString()} UU / week (≈ {x.allowance.weeklyTiRequests.toLocaleString()} market-data requests)</li>
                  <li>{x.allowance.sessionUu.toLocaleString()} UU per {x.allowance.sessionHours} h session</li>
                  <li>{x.limits.api_keys} API key{x.limits.api_keys > 1 ? "s" : ""}</li>
                </ul>
                {x.kind !== "free" && current?.id !== x.id && (x.purchasable
                  ? <Link href="/billing/add" className="mt-3 inline-block text-xs text-sl-accent hover:underline">Choose {x.name}</Link>
                  : <p className="mt-3 text-[11px] text-sl-text-subtle">Not available to buy yet</p>)}
              </div>
            ))}
          </div>
        )}
        {cat && <p className="mt-3 text-[11px] text-sl-text-subtle">1 UU = ${cat.unit.usd_list_value} of list price. Plans and packs are paid by card or UPI through Dodo Payments (merchant of record) and pay for market data only; RPC and x402 use crypto credits.</p>}
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Credit packs">
          {cat ? (
            <Table head={["Pack", "UU", "≈ requests", ""]} numeric={[1, 2]}>
              {cat.packs.map((k) => (
                <tr key={k.id}><td>${k.priceUsd}</td><td className="text-right">{k.grantUu.toLocaleString()}</td><td className="text-right">{k.tiRequests.toLocaleString()}</td>
                  <td className="text-right">{k.purchasable ? <Link className="text-xs text-sl-accent hover:underline" href="/billing/add">Buy</Link> : <span className="text-[11px] text-sl-text-subtle">soon</span>}</td></tr>
              ))}
            </Table>
          ) : <ErrorNote what="packs" />}
        </Panel>
        <Panel title="USDT deposits (Polygon)">
          {!deposits.ok ? <ErrorNote what="deposits" /> : deposits.data.length === 0 ? (
            <Empty title="No deposits yet" body="USDT deposits credited to your keys appear here with their Polygon transaction." cta={{ label: "Add USDT", href: "/billing/add" }} />
          ) : (
            <Table head={["Date", "Key", "Transaction", "Amount"]} numeric={[3]}>
              {deposits.data.map((x) => (
                <tr key={x.txHash}><td>{date(x.at)}</td><td>{x.key.label}</td>
                  <td><a className="font-mono hover:underline" href={`https://polygonscan.com/tx/${x.txHash}`} target="_blank" rel="noopener">{shortHash(x.txHash)}</a></td>
                  <td className="text-right">{x.amountUsdt.toFixed(2)} USDT</td></tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
