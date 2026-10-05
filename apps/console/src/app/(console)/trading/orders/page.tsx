import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { PageHeader, Panel } from "@/components/ui";
import { ApiState, ModeBadge, TradingDisclosure } from "@/components/trading/parts";
import { tradingGet } from "@/lib/trading/client";
import { requireAgentIa } from "@/lib/trading/guard";
import { placePaperOrder } from "../actions";

export const metadata: Metadata = { title: "Orders" };

const ERRORS: Record<string, string> = {
  confirm: "Tick the box to confirm this is a paper order.", REFUSED: "Your limits or your signed permission didn't allow this order.",
  IDEMPOTENCY_KEY_REUSED: "This form was already used for a different order. Reload and try again.", RATE_LIMITED: "Too many orders in a minute.",
};
const input = "rounded border border-sl-border bg-sl-bg px-2 py-1";

export default async function OrdersPage({ searchParams }: { searchParams?: Promise<{ error?: string; message?: string }> }) {
  requireAgentIa();
  const sp = (searchParams ? await searchParams : undefined) ?? {};
  const list = await tradingGet<unknown[]>("/orders");
  return (
    <>
      <PageHeader title="Orders" lede="Orders you placed or approved." actions={<ModeBadge mode="paper" />} />
      {sp.error && <p role="alert" className="mb-3 rounded border border-sl-border bg-sl-surface p-2">{ERRORS[sp.error] ?? "That order wasn't accepted. Nothing was sent."}{sp.message ? ` (${sp.message})` : ""}</p>}
      <Panel title="Place a paper order">
        <form action={placePaperOrder} className="grid max-w-xl gap-2 sm:grid-cols-2">
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <label className="grid gap-1">Broker account<input name="brokerAccountId" required className={input} placeholder="bka_…" /></label>
          <label className="grid gap-1">Signed permission (mandate)<input name="mandateId" required className={input} placeholder="mdt_…" /></label>
          <label className="grid gap-1">Broker<select name="venue" aria-label="Broker" className={input} defaultValue="binance"><option value="binance">Binance (test network)</option><option value="mock">Simulator</option></select></label>
          <label className="grid gap-1">Instrument<input name="instrument" required className={input} placeholder="BTC-USDT" /></label>
          <label className="grid gap-1">Side<select name="side" aria-label="Side" className={input}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
          <label className="grid gap-1">Quantity<input name="quantity" required inputMode="decimal" className={input} /></label>
          <label className="grid gap-1">Limit price<input name="limitPrice" required inputMode="decimal" className={input} /></label>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="understand" value="yes" required /> I understand this is a paper order — simulated, no real money.</label>
          <button type="submit" className="rounded bg-sl-accent px-3 py-1.5 font-medium text-sl-bg sm:col-span-2 sm:justify-self-start">Place paper order</button>
        </form>
        <p className="mt-2 text-sl-text-muted">Your limits and your signed permission are checked before anything is sent.</p>
      </Panel>
      <Panel title="All orders" className="mt-4">
        {list.ok ? <p>{list.data.length} orders</p> : <ApiState status={list.status} code={list.code} what="order history" />}
      </Panel>
      <TradingDisclosure />
    </>
  );
}
