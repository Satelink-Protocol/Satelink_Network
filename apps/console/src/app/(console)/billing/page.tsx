import type { Metadata } from "next";
import { Badge, Empty, ErrorNote, Kpi, NeedsKey, PageHeader, Panel, Table } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { loadKey } from "@/lib/data";
import { date, int, shortHash, usd } from "@/lib/format";
import { getActiveKey } from "@/lib/keys";

export const metadata: Metadata = { title: "Billing" };

const WEB = "https://satelink.network";

type DepositInfo = { ok: true; current_tier: string; current_limit: number; credits_balance: number; total_deposited: number };
type Plans = { ok: true; plans: { id: string; name: string; price: { monthly: number; yearly: number }; includedCalls: number; overagePerCall: number | null; apiKeys: number }[] };

export default async function BillingPage() {
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
