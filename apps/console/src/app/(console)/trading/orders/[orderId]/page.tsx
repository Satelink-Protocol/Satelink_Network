import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { Badge, PageHeader, Panel, Table } from "@/components/ui";
import { ApiState, ModeBadge, OrderState, TradingDisclosure } from "@/components/trading/parts";
import { tradingGet } from "@/lib/trading/client";
import { requireAgentIa } from "@/lib/trading/guard";
import { receiptText, venueName } from "@/lib/trading/states";
import { traceLink } from "@/lib/trading/trace";
import { traceUrlTemplate } from "@/lib/trading/flags";
import { requestCancel } from "../../actions";

export const metadata: Metadata = { title: "Order" };

type Order = { id: string; status: string; venue: string; mode: string; instrument: string; side: string; orderType: string; quantity: string; limitPrice: string | null; filledQuantity: string; avgFillPrice: string | null; clientOrderId: string; createdAt: number | string };
type Receipt = { completeness?: { complete: boolean; missing: string[] }; ledger?: { note?: string }; traceparent?: string | null };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams?: Promise<{ placed?: string; cancel?: string; error?: string }> }) {
  requireAgentIa();
  const { orderId } = await params;
  const sp = (searchParams ? await searchParams : undefined) ?? {};
  const [order, receipt] = await Promise.all([tradingGet<Order>(`/orders/${encodeURIComponent(orderId)}`), tradingGet<Receipt>(`/orders/${encodeURIComponent(orderId)}/receipt`)]);
  if (!order.ok) return (<><PageHeader title="Order" /><ApiState status={order.status} code={order.code} what="this order" /></>);
  const o = order.data;
  const cancellable = o.status === "acknowledged" || o.status === "partially_filled";
  return (
    <>
      <PageHeader title={`${o.side === "buy" ? "Buy" : "Sell"} ${o.quantity} ${o.instrument}`} lede={`At ${venueName(o.venue)}`} actions={<ModeBadge mode={o.mode} />} />
      {sp.placed && <p role="status" className="mb-3 rounded border border-sl-border bg-sl-surface p-2">Order received. Your limits and permission were checked.</p>}
      {sp.cancel && <p role="status" className="mb-3 rounded border border-sl-border bg-sl-surface p-2">Cancel requested.</p>}
      {sp.error && <p role="alert" className="mb-3 rounded border border-sl-border bg-sl-surface p-2">That didn't work. Nothing was changed.</p>}
      <Panel title="Status">
        <p className="mb-2"><OrderState status={o.status} venue={o.venue} /></p>
        <Table head={["Detail", "Value"]}>
          <tr><td>Type</td><td>{o.orderType === "limit" ? `Limit at ${o.limitPrice}` : o.orderType}</td></tr>
          <tr><td>Filled</td><td className="tnum">{o.filledQuantity} of {o.quantity}{o.avgFillPrice ? ` at ${o.avgFillPrice}` : ""}</td></tr>
          <tr><td>Reference</td><td className="font-mono text-[11px]">{o.clientOrderId}</td></tr>
        </Table>
        {cancellable && (
          <form action={requestCancel} className="mt-3">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <input type="hidden" name="orderId" value={o.id} />
            <button type="submit" className="rounded border border-sl-border px-3 py-1.5">Cancel this order</button>
          </form>
        )}
      </Panel>
      <Panel title="Why did Satelink do this?" className="mt-4">
        {!receipt.ok ? <ApiState status={receipt.status} code={receipt.code} what="the receipt" /> : (
          <>
            <p><Badge tone={receiptText(receipt.data).complete ? "good" : "warn"}>{receiptText(receipt.data).text}</Badge></p>
            <p className="mt-1 text-sl-text-muted">Paper results are not added to your account statement.</p>
            {(() => {
              const t = traceLink(receipt.data.traceparent, traceUrlTemplate());
              if (!t) return null;
              return (
                <p className="mt-1 text-sl-text-muted">
                  Trace reference <span className="font-mono text-[11px]">{t.traceId}</span>
                  {t.url && <> · <a className="text-sl-accent underline" href={t.url} rel="noopener noreferrer" target="_blank">Open the full trace</a></>}
                </p>
              );
            })()}
          </>
        )}
      </Panel>
      <TradingDisclosure />
    </>
  );
}
