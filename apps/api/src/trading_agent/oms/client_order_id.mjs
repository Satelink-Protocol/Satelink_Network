// client_order_id generator (Stage 17).
//
// Deterministic from the OMS order id, so every resend of the same order carries the
// SAME client id (the venue's duplicate guard and history lookup both depend on it).
// Lowercase hex after a fixed prefix fits every venue's charset; the length honours
// the venue rule and the adapter's declared clientOrderIdMaxLength, whichever is shorter.
import { createHash } from 'node:crypto';
import { OmsError } from './errors.mjs';

export const CLIENT_ID_PREFIX = 'sl';
/** Venue rules (documented API limits): Binance newClientOrderId ≤ 36; Upstox order tag ≤ 20; Alpaca client_order_id ≤ 48 (kept conservative); mock 64. */
export const VENUE_CLIENT_ID_MAX = Object.freeze({ binance: 36, upstox: 20, alpaca: 48, mock: 64 });
const MIN_LENGTH = 18; // ≥ 64 bits of hash after the prefix

export function clientOrderIdFor(orderId, venue, capabilities) {
  if (typeof orderId !== 'string' || !/^ord_[A-Za-z0-9_]{1,64}$/.test(orderId)) throw new OmsError('CONFIG', `bad order id ${orderId}`);
  const venueMax = VENUE_CLIENT_ID_MAX[venue];
  if (!venueMax) throw new OmsError('CONFIG', `no client id rule for venue ${venue}`);
  const len = Math.min(venueMax, capabilities?.clientOrderIdMaxLength ?? venueMax, 32);
  if (len < MIN_LENGTH) throw new OmsError('CONFIG', `venue ${venue} allows only ${len}-char client ids (< ${MIN_LENGTH})`);
  const digest = createHash('sha256').update(`satelink.oms.client-id|${orderId}`, 'utf8').digest('hex');
  return CLIENT_ID_PREFIX + digest.slice(0, len - CLIENT_ID_PREFIX.length);
}
