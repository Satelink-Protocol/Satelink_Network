// Binance ↔ Stage 10 mapping (Stage 21): client ids (Link prefix), order snapshots,
// WebSocket executionReport events, and fills.
import { mapVenueStatus } from '../status_map.mjs';
import { normalizeFill } from '../fills.mjs';
import { parseDecimal, formatDecimal, divRound, Rounding } from '../decimal.mjs';
import { BINANCE_CLIENT_ID_RE, BINANCE_CLIENT_ID_MAX, LINK_ID_RE } from './config.mjs';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';

export function linkPrefix(linkId) {
  if (!LINK_ID_RE.test(String(linkId ?? ''))) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'binance', message: 'a Binance Link ID (4–16 alphanumerics) is required' });
  return `x-${linkId}`;
}

/** Internal (OMS) client id → the newClientOrderId sent to Binance. */
export function toVenueClientId(prefix, internalId) {
  const id = `${prefix}${internalId}`;
  if (id.length > BINANCE_CLIENT_ID_MAX || !BINANCE_CLIENT_ID_RE.test(id)) {
    throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'binance', message: `newClientOrderId "${id}" breaks the Binance rule (≤ ${BINANCE_CLIENT_ID_MAX}, [.A-Z:/a-z0-9_-])` });
  }
  return id;
}
/** Binance client id → internal id, or null when it is not one of ours (other apps, Binance-generated). */
export function fromVenueClientId(prefix, venueId) {
  return typeof venueId === 'string' && venueId.startsWith(prefix) && venueId.length > prefix.length ? venueId.slice(prefix.length) : null;
}

const canon = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!s.includes('.')) return s;
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '' || t === '-0' ? '0' : t;
};
/** Exact average price = cumulative quote / executed qty, half-even to 8 dp (no floats). */
const avg = (quoteQty, qty) => {
  const q = canon(qty);
  const n = canon(quoteQty);
  if (!q || q === '0' || !n || n === '0') return null;
  const a = parseDecimal(n);
  const b = parseDecimal(q);
  // (A/10^sa) / (B/10^sb) × 10^8 = A·10^(sb+8) / (B·10^sa)
  const units = divRound(a.units * 10n ** BigInt(b.scale + 8), b.units * 10n ** BigInt(a.scale), Rounding.HALF_EVEN);
  return canon(formatDecimal(units, 8));
};

/** GET/DELETE /api/v3/order or POST (FULL) response → Stage 10 order snapshot. */
export function orderSnapshot(prefix, o, internalId) {
  return Object.freeze({
    clientOrderId: internalId ?? fromVenueClientId(prefix, o.clientOrderId ?? o.origClientOrderId),
    brokerOrderId: o.orderId == null ? null : String(o.orderId),
    status: mapVenueStatus('binance', o.status),
    quantity: canon(o.origQty),
    filledQuantity: canon(o.executedQty) ?? '0',
    averagePrice: avg(o.cummulativeQuoteQty, o.executedQty),
    venueSymbol: o.symbol,
  });
}

/**
 * WebSocket API user-data event ({ subscriptionId, event }) → normalised update, or null for
 * events that are not executionReports / not our orders.
 */
export function mapExecutionReport(prefix, message) {
  const e = message?.event ?? message;
  if (!e || e.e !== 'executionReport') return null;
  const own = fromVenueClientId(prefix, e.c) ?? fromVenueClientId(prefix, e.C); // cancels carry the original id in C
  if (!own) return Object.freeze({ ours: false, venueClientOrderId: e.c });
  const trade = e.x === 'TRADE';
  return Object.freeze({
    ours: true,
    clientOrderId: own,
    brokerOrderId: String(e.i),
    venueSymbol: e.s,
    side: String(e.S).toLowerCase(),
    executionType: String(e.x).toLowerCase(),
    status: mapVenueStatus('binance', e.X),
    rejectReason: e.r && e.r !== 'NONE' ? e.r : null,
    quantity: canon(e.q),
    filledQuantity: canon(e.z) ?? '0',
    eventTime: new Date(e.E).toISOString(),
    fill: trade ? normalizeFill({
      fillId: String(e.t), clientOrderId: own, brokerOrderId: String(e.i), quantity: canon(e.l), price: canon(e.L),
      fee: feeOf(e.n, e.N), executedAt: new Date(e.T).toISOString(),
    }) : null,
  });
}

/** Commission as a Stage 10 fee: decimals = the commission string's own precision (exact). */
export function feeOf(amount, asset) {
  const s = canon(amount) ?? '0';
  if (s === '0') return { amount: '0', currency: asset ?? null, decimals: 0 };
  return { amount: s, currency: asset, decimals: (s.split('.')[1] ?? '').length };
}

/** GET /api/v3/myTrades rows → normalised fills. */
export function tradesToFills(internalId, trades) {
  return trades.map((t) => normalizeFill({
    fillId: String(t.id), clientOrderId: internalId, brokerOrderId: String(t.orderId), quantity: canon(t.qty), price: canon(t.price),
    fee: feeOf(t.commission, t.commissionAsset), executedAt: new Date(t.time).toISOString(),
  }));
}
