// Alpaca ↔ Stage 10 mapping (Stage 23): order bodies (with commission), order snapshots, SSE
// trade events → updates + fills, FILL activities → fills, and a PII-free account summary.
import { mapVenueStatus } from '../status_map.mjs';
import { normalizeFill } from '../fills.mjs';

const canon = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!s.includes('.')) return s;
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '' || t === '-0' ? '0' : t;
};

export function orderBody(order, instrument, commission = null) {
  const body = {
    symbol: instrument.venueSymbol, qty: order.quantity, side: order.side, type: order.type, time_in_force: order.timeInForce ?? 'day',
    client_order_id: order.clientOrderId,
  };
  if (order.type === 'limit') body.limit_price = order.limitPrice;
  if (commission) Object.assign(body, commission); // { commission, commission_type }
  return body;
}

export function orderSnapshot(o) {
  return Object.freeze({
    clientOrderId: o.client_order_id ?? null,
    brokerOrderId: o.id ?? null,
    status: mapVenueStatus('alpaca', o.status),
    quantity: canon(o.qty),
    filledQuantity: canon(o.filled_qty) ?? '0',
    averagePrice: canon(o.filled_avg_price),
    venueSymbol: o.symbol ?? null,
    commission: canon(o.commission),
    commissionType: o.commission_type ?? null,
  });
}

/** One SSE trade event (v2) → { eventId, event, accountId, at, snapshot, fill|null }. */
export function mapTradeEvent(e) {
  const order = e.order ?? {};
  const isFill = e.event === 'fill' || e.event === 'partial_fill';
  const at = e.timestamp ?? e.at;
  return Object.freeze({
    eventId: e.event_id, event: e.event, accountId: e.account_id ?? null, at: e.at ?? null,
    snapshot: orderSnapshot(order),
    positionQty: canon(e.position_qty),
    fill: isFill ? normalizeFill({
      fillId: String(e.execution_id ?? e.event_id), clientOrderId: order.client_order_id, brokerOrderId: order.id ?? null,
      quantity: canon(e.qty), price: canon(e.price), executedAt: new Date(at).toISOString(),
    }) : null,
  });
}

/** FILL account activities → fills for one order. */
export function activitiesToFills(clientOrderId, orderId, rows) {
  return rows.filter((a) => a.activity_type === 'FILL' && a.order_id === orderId).map((a) => normalizeFill({
    fillId: String(a.id), clientOrderId, brokerOrderId: orderId, quantity: canon(a.qty), price: canon(a.price), executedAt: new Date(a.transaction_time).toISOString(),
  }));
}

/** GET /v1/accounts/{id} → the fields Satelink needs. Identity/contact PII is dropped, never returned. */
export function accountSummary(a) {
  return Object.freeze({
    accountId: a.id, accountNumber: a.account_number ?? null, status: a.status ?? null, accountType: a.account_type ?? null,
    currency: a.currency ?? null, cryptoStatus: a.crypto_status ?? null, createdAt: a.created_at ?? null, lastEquity: canon(a.last_equity),
  });
}
