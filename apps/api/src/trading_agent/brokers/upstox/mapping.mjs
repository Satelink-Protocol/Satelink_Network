// Upstox ↔ Stage 10 mapping (Stage 22): LIMIT order bodies, order snapshots (details / stream),
// trades → fills, position updates. Upstox timestamps are IST without an offset.
import { mapVenueStatus, refineByQuantity } from '../status_map.mjs';
import { normalizeFill } from '../fills.mjs';
import { compareDecimal } from '../decimal.mjs';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';

const bad = (m) => new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'upstox', message: m });
const canon = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!s.includes('.')) return s;
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '' || t === '-0' ? '0' : t;
};

/** Upstox takes price as a JSON number: refuse any decimal that would not survive the round trip. */
export function exactNumber(decimal, name) {
  const n = Number(decimal);
  if (!Number.isFinite(n) || canon(String(n)) !== canon(decimal)) throw bad(`${name} ${decimal} cannot be sent exactly`);
  return n;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** "2024-02-21 14:40:02" or "03-Aug-2017 15:03:42" (IST) → ISO UTC. */
export function parseIst(s) {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
  const dmy = /^(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  let parts;
  if (iso) parts = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4]), Number(iso[5]), Number(iso[6])];
  else if (dmy && Object.hasOwn(MONTHS, dmy[2])) parts = [Number(dmy[3]), MONTHS[dmy[2]], Number(dmy[1]), Number(dmy[4]), Number(dmy[5]), Number(dmy[6])];
  else throw new RangeError(`unrecognised Upstox timestamp ${s}`);
  return new Date(Date.UTC(...parts) - 330 * 60_000).toISOString(); // IST = UTC+05:30
}

/** Normalized LIMIT order → POST /v3/order/place body. No X-Algo-Name, no MARKET, no slicing. */
export function placeBody(order, instrument, { product = 'D' } = {}) {
  if (order.type !== 'limit') throw bad('Satelink sends LIMIT orders only to Upstox');
  if (!/^[1-9]\d*$/.test(order.quantity)) throw bad('Upstox quantity must be a positive integer');
  const validity = (order.timeInForce ?? 'day').toUpperCase();
  if (!['DAY', 'IOC'].includes(validity)) throw bad(`validity ${validity} not supported by Upstox`);
  return {
    quantity: Number(order.quantity), product, validity, price: exactNumber(order.limitPrice, 'price'), tag: order.clientOrderId,
    instrument_token: instrument.venueSymbol, order_type: 'LIMIT', transaction_type: order.side.toUpperCase(),
    disclosed_quantity: 0, trigger_price: 0, is_amo: false, slice: false,
  };
}

/** GET /v2/order/details `data`, or a portfolio-stream order update → Stage 10 snapshot. */
export function orderSnapshot(d) {
  const quantity = canon(d.quantity);
  const filledQuantity = canon(d.filled_quantity) ?? '0';
  const raw = mapVenueStatus('upstox', d.status);
  return Object.freeze({
    clientOrderId: d.tag ?? null,
    brokerOrderId: d.order_id == null ? null : String(d.order_id),
    status: refineByQuantity(raw, { filledQuantity, quantity }, compareDecimal),
    quantity,
    filledQuantity,
    averagePrice: Number(d.average_price) > 0 ? canon(d.average_price) : null,
    venueSymbol: d.instrument_token ?? d.instrument_key ?? null,
    statusMessage: d.status_message || null,
    venueTime: d.order_timestamp ? parseIst(d.order_timestamp) : null,
  });
}

/** Portfolio stream message → { kind: 'order', ours, snapshot } | { kind: 'position', … } | null. */
export function mapStreamMessage(msg, { isOurs = (tag) => typeof tag === 'string' && tag.startsWith('sl') } = {}) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.update_type === 'order') {
    const snap = orderSnapshot(msg);
    return Object.freeze({ kind: 'order', ours: isOurs(msg.tag), snapshot: snap });
  }
  if (msg.update_type === 'position') {
    return Object.freeze({
      kind: 'position', instrumentKey: msg.instrument_key ?? msg.instrument_token, product: msg.product, quantity: canon(msg.quantity),
      buyQuantity: canon(msg.day_buy_quantity), sellQuantity: canon(msg.day_sell_quantity), buyPrice: canon(msg.buy_price), sellPrice: canon(msg.sell_price),
      overnightQuantity: canon(msg.overnight_quantity),
    });
  }
  if (msg.update_type === 'holding') return Object.freeze({ kind: 'holding', instrumentKey: msg.instrument_key ?? msg.instrument_token, quantity: canon(msg.quantity), averagePrice: canon(msg.average_price) });
  return null;
}

/** GET /v2/order/trades rows → normalized fills. Charges are not in this payload (fee 0, contract notes carry them). */
export function tradesToFills(clientOrderId, rows) {
  return rows.map((t) => normalizeFill({
    fillId: String(t.trade_id), clientOrderId, brokerOrderId: t.order_id == null ? null : String(t.order_id),
    quantity: canon(t.quantity), price: canon(t.average_price), executedAt: parseIst(t.exchange_timestamp),
  }));
}
