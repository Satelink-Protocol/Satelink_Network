import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Badge, Empty, ErrorNote, Kpi, NeedsKey, PageHeader, Panel, Table } from "@/components/ui";
import { loadKey, series, windowSum } from "@/lib/data";
import { date, int, shortHash, usd } from "@/lib/format";
import { getActiveKey, getKeys } from "@/lib/keys";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Overview" };

export default async function Overview() {
  const [session, keys, active] = await Promise.all([getSession(), getKeys(), getActiveKey()]);
  const d = active ? await loadKey(active.k) : null;
  const s = d?.summary;
  const days = d?.days;

  const checklist = [
    { label: "Verify your email", done: !!session?.user.emailVerified, href: "/settings" },
    { label: "Create or connect an API key", done: keys.length > 0, href: "/keys" },
    { label: "Make your first call", done: !!days && days.some((x) => x.calls > 0), href: "/rpc" },
    { label: "Fund your account or pick a plan", done: !!s && (s.balanceUsd > 0 || (s.plan && s.plan !== "free")), href: "/billing" },
  ];
  const onboardingDone = checklist.every((c) => c.done);

  return (
    <>
      <PageHeader title="Overview" lede={active ? `Showing ${active.label}.` : "Balance, spend and activity for your keys."} />

      {!onboardingDone && (
        <Panel title="Get started" className="mb-4">
          <ol className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {checklist.map((c) => (
              <li key={c.label}>
                <Link href={c.href} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-sl-surface-hover">
                  {c.done ? <CheckCircle2 className="size-4 text-sl-accent" /> : <Circle className="size-4 text-sl-text-subtle" />}
                  <span className={c.done ? "text-sl-text-muted line-through" : "text-sl-text"}>{c.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {!active ? (
        <NeedsKey />
      ) : !s ? (
        <ErrorNote what="your account summary" />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Crypto credits" value={usd(s.balanceUsd, 4)} hint="USDT-funded, spent per call" />
            <Kpi label="Plan" value={<span className="capitalize">{s.plan}</span>} hint={s.subscription ? `Status: ${s.subscription.status}` : "No paid subscription"} />
            <Kpi label="Calls today" value={s.usage ? int(s.usage.callsToday) : null} spark={days ? series(days, 14, "calls") : undefined} />
            <Kpi label="Calls this month" value={s.usage ? int(s.usage.callsThisMonth) : null} />
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {days ? (
              <>
                <Kpi label="Spent today" value={usd(windowSum(days, 1, "spent"), 5)} />
                <Kpi label="Spent 7 days" value={usd(windowSum(days, 7, "spent"), 5)} spark={series(days, 7, "spent")} />
                <Kpi label="Spent 30 days" value={usd(windowSum(days, 30, "spent"), 5)} spark={series(days, 30, "spent")} />
              </>
            ) : (
              <div className="sm:col-span-3"><ErrorNote what="spend history" /></div>
            )}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel title="Plan allowance (Dodo bucket)">
              {s.entitlement ? (
                <Table head={["Field", "Value"]}>
                  {Object.entries(s.entitlement).map(([k, v]) => (
                    <tr key={k}><td className="text-sl-text-muted">{k}</td><td className="font-mono">{String(v)}</td></tr>
                  ))}
                </Table>
              ) : (
                <Empty title="No plan allowance" body="Paid plans bought by card or UPI add a monthly allowance for Trading Intelligence. This key has none." cta={{ label: "See plans", href: "/billing" }} />
              )}
            </Panel>
            <Panel title="Recent deposits" action={<Link href="/billing" className="text-xs text-sl-text-muted hover:text-sl-text">Billing →</Link>}>
              {d?.deposits === null ? (
                <ErrorNote what="deposits" />
              ) : d && d.deposits.length > 0 ? (
                <Table head={["Date", "Tx", "Amount"]} numeric={[2]}>
                  {d.deposits.slice(0, 5).map((x) => (
                    <tr key={x.tx_hash}>
                      <td>{date(x.created_at)}</td>
                      <td><a className="font-mono hover:underline" href={`https://polygonscan.com/tx/${x.tx_hash}`} rel="noopener" target="_blank">{shortHash(x.tx_hash)}</a></td>
                      <td className="text-right">{Number(x.amount_usdt).toFixed(2)} USDT</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty title="No deposits yet" body="USDT deposits to RevenueVault V2 on Polygon credit this key." cta={{ label: "Deposit USDT", href: "/billing" }} />
              )}
            </Panel>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel title="Calls by product">
              <Empty title="Not broken down yet" body="The API reports calls per key per day, not per product. The daily totals are in Usage." cta={{ label: "Open Usage", href: "/usage" }} />
            </Panel>
            <Panel title="Keys">
              <Table head={["Key", "Label", ""]}>
                {keys.map((k) => (
                  <tr key={k.k}>
                    <td className="font-mono">{k.k.slice(0, 7)}…{k.k.slice(-4)}</td>
                    <td>{k.label}</td>
                    <td className="text-right">{k.k === active.k && <Badge tone="good">active</Badge>}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
