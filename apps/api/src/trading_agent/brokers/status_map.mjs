// Venue order-status → normalized BrokerOrderStatus (Stage 10).
//
// Tables are keyed by the venue's status string, lower-cased and trimmed.
// Anything not in a table maps to UNKNOWN; we never guess. Values are per the
// venues' public API documentation and must be re-verified in each connector stage.
import { BrokerOrderStatus as S, Venue } from './types.mjs';

export const BINANCE_STATUS = Object.freeze({
  new: S.ACKNOWLEDGED,
  pending_new: S.PENDING_NEW,
  partially_filled: S.PARTIALLY_FILLED,
  filled: S.FILLED,
  canceled: S.CANCELLED,
  pending_cancel: S.PENDING_CANCEL,
  rejected: S.REJECTED,
  expired: S.EXPIRED,
  expired_in_match: S.EXPIRED, // expired by self-trade prevention
});

export const ALPACA_STATUS = Object.freeze({
  new: S.ACKNOWLEDGED,
  accepted: S.PENDING_NEW,
  pending_new: S.PENDING_NEW,
  accepted_for_bidding: S.PENDING_NEW,
  held: S.PENDING_NEW,              // e.g. a bracket leg waiting on its parent
  partially_filled: S.PARTIALLY_FILLED,
  filled: S.FILLED,
  done_for_day: S.ACKNOWLEDGED,     // not terminal: resumes next session
  canceled: S.CANCELLED,
  expired: S.EXPIRED,
  replaced: S.CANCELLED,            // this order id is closed; a replacement order exists
  pending_cancel: S.PENDING_CANCEL,
  pending_replace: S.ACKNOWLEDGED,  // still working until the replace completes
  stopped: S.ACKNOWLEDGED,
  rejected: S.REJECTED,
  suspended: S.ACKNOWLEDGED,        // exists at the venue, not tradable right now
  calculated: S.ACKNOWLEDGED,       // execution done, settlement calculations pending
});

export const UPSTOX_STATUS = Object.freeze({
  'put order req received': S.PENDING_NEW,
  'validation pending': S.PENDING_NEW,
  'open pending': S.PENDING_NEW,
  'after market order req received': S.PENDING_NEW,
  open: S.ACKNOWLEDGED,             // partial fills stay "open"; see refineByQuantity
  'trigger pending': S.ACKNOWLEDGED,
  'modify pending': S.ACKNOWLEDGED,
  'modify validation pending': S.ACKNOWLEDGED,
  'modify after market order req received': S.ACKNOWLEDGED,
  modified: S.ACKNOWLEDGED,
  'not modified': S.ACKNOWLEDGED,
  'not cancelled': S.ACKNOWLEDGED,
  'cancel pending': S.PENDING_CANCEL,
  complete: S.FILLED,
  rejected: S.REJECTED,
  cancelled: S.CANCELLED,
  'cancelled after market order': S.CANCELLED,
});

/** The mock venue speaks the normalized vocabulary directly. */
export const MOCK_STATUS = Object.freeze(Object.fromEntries(Object.values(S).map((s) => [s, s])));

export const STATUS_TABLES = Object.freeze({
  [Venue.BINANCE]: BINANCE_STATUS,
  [Venue.ALPACA]: ALPACA_STATUS,
  [Venue.UPSTOX]: UPSTOX_STATUS,
  [Venue.MOCK]: MOCK_STATUS,
});

/** Raw venue status → normalized status. Unknown venue or value → UNKNOWN. */
export function mapVenueStatus(venue, rawStatus) {
  const table = STATUS_TABLES[venue];
  if (!table || typeof rawStatus !== 'string') return S.UNKNOWN;
  const key = rawStatus.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : S.UNKNOWN;
}

/**
 * Quantity-aware refinement: a working order with some fill is PARTIALLY_FILLED
 * (Upstox reports partial fills as "open"). Quantities are decimal strings.
 */
export function refineByQuantity(status, { filledQuantity, quantity } = {}, compare) {
  if (status !== S.ACKNOWLEDGED || filledQuantity == null || quantity == null) return status;
  if (compare(filledQuantity, '0') > 0 && compare(filledQuantity, quantity) < 0) return S.PARTIALLY_FILLED;
  return status;
}
