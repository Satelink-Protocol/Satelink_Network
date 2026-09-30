// Normalized broker errors (Stage 10).
//
// Every error carries the SUBMIT OUTCOME, the thing an order manager needs to
// decide what to do next:
//   NOT_PLACED → the venue does not have the order; a retry with the SAME client
//                order id is safe when `retryable` is true.
//   UNKNOWN    → the request may or may not have reached the book (AMBIGUOUS).
//                Reconcile by client order id first; never blind-retry.
import { SubmitOutcome, Venue } from './types.mjs';

export const BrokerErrorCode = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INSTRUMENT_NOT_TRADABLE: 'INSTRUMENT_NOT_TRADABLE',
  MARKET_CLOSED: 'MARKET_CLOSED',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH_FAILED: 'AUTH_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  DUPLICATE_CLIENT_ORDER_ID: 'DUPLICATE_CLIENT_ORDER_ID',
  REJECTED: 'REJECTED',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  TIMEOUT_BEFORE_ACCEPT: 'TIMEOUT_BEFORE_ACCEPT',
  AMBIGUOUS: 'AMBIGUOUS',
  VENUE_UNAVAILABLE: 'VENUE_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
});

/** code → { outcome, retryable }. The single source of truth for retry policy. */
export const ERROR_SEMANTICS = Object.freeze({
  INVALID_REQUEST: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
  INSUFFICIENT_FUNDS: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
  INSTRUMENT_NOT_TRADABLE: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
  MARKET_CLOSED: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
  RATE_LIMITED: { outcome: SubmitOutcome.NOT_PLACED, retryable: true },
  AUTH_FAILED: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
  PERMISSION_DENIED: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
  // This request was not placed, but an EARLIER one with the same id may be live → reconcile.
  DUPLICATE_CLIENT_ORDER_ID: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
  REJECTED: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
  ORDER_NOT_FOUND: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
  TIMEOUT_BEFORE_ACCEPT: { outcome: SubmitOutcome.NOT_PLACED, retryable: true },
  AMBIGUOUS: { outcome: SubmitOutcome.UNKNOWN, retryable: false },
  VENUE_UNAVAILABLE: { outcome: SubmitOutcome.NOT_PLACED, retryable: true },
  INTERNAL: { outcome: SubmitOutcome.NOT_PLACED, retryable: false },
});

export class BrokerError extends Error {
  /**
   * @param {string} code one of BrokerErrorCode
   * @param {object} [info] { venue, venueCode, httpStatus, message }
   */
  constructor(code, { venue = null, venueCode = null, httpStatus = null, message } = {}) {
    if (!ERROR_SEMANTICS[code]) throw new TypeError(`unknown BrokerErrorCode: ${code}`);
    super(message || code);
    this.name = 'BrokerError';
    this.code = code;
    this.outcome = ERROR_SEMANTICS[code].outcome;
    this.retryable = ERROR_SEMANTICS[code].retryable;
    this.venue = venue;
    this.venueCode = venueCode;
    this.httpStatus = httpStatus;
  }
}

// Venue error-code tables (subset; extend in connector stages). Codes are per the
// venues' public API documentation and must be re-verified when a connector is built.
export const BINANCE_ERROR_CODES = Object.freeze({
  '-1003': BrokerErrorCode.RATE_LIMITED,          // too many requests
  '-1007': BrokerErrorCode.AMBIGUOUS,             // timeout waiting for backend; execution status unknown
  '-1013': BrokerErrorCode.INVALID_REQUEST,       // filter failure (lot size, tick, notional)
  '-1015': BrokerErrorCode.RATE_LIMITED,          // too many new orders
  '-1021': BrokerErrorCode.INVALID_REQUEST,       // timestamp outside recvWindow
  '-1022': BrokerErrorCode.AUTH_FAILED,           // invalid signature
  '-1121': BrokerErrorCode.INSTRUMENT_NOT_TRADABLE, // invalid symbol
  '-2013': BrokerErrorCode.ORDER_NOT_FOUND,       // order does not exist
  '-2014': BrokerErrorCode.AUTH_FAILED,           // API-key format invalid
  '-2015': BrokerErrorCode.AUTH_FAILED,           // invalid API key, IP or permissions
});

/**
 * Map a venue failure to a BrokerError.
 * @param {string} venue
 * @param {object} f  { sent: boolean, httpStatus?, venueCode?, message? }
 *   sent=false → the request never left the process (DNS/connect failure).
 *   sent=true with no httpStatus → the connection died after sending (timeout/reset).
 */
export function mapVenueError(venue, { sent, httpStatus = null, venueCode = null, message = '' } = {}) {
  const info = { venue, venueCode: venueCode == null ? null : String(venueCode), httpStatus, message };
  const msg = String(message || '').toLowerCase();

  if (!sent) return new BrokerError(BrokerErrorCode.VENUE_UNAVAILABLE, info);
  if (httpStatus == null) return new BrokerError(BrokerErrorCode.AMBIGUOUS, info);

  if (venue === Venue.BINANCE && venueCode != null) {
    const code = String(venueCode);
    if (BINANCE_ERROR_CODES[code]) return new BrokerError(BINANCE_ERROR_CODES[code], info);
    if (code === '-2010') {
      if (msg.includes('insufficient balance')) return new BrokerError(BrokerErrorCode.INSUFFICIENT_FUNDS, info);
      if (msg.includes('duplicate order')) return new BrokerError(BrokerErrorCode.DUPLICATE_CLIENT_ORDER_ID, info);
      return new BrokerError(BrokerErrorCode.REJECTED, info);
    }
    if (code === '-2011') {
      if (msg.includes('unknown order')) return new BrokerError(BrokerErrorCode.ORDER_NOT_FOUND, info);
      return new BrokerError(BrokerErrorCode.REJECTED, info);
    }
  }

  if (httpStatus === 429 || httpStatus === 418) return new BrokerError(BrokerErrorCode.RATE_LIMITED, info);
  if (httpStatus >= 500) return new BrokerError(BrokerErrorCode.AMBIGUOUS, info); // venue-side failure: execution status unknown
  if (httpStatus === 401) return new BrokerError(BrokerErrorCode.AUTH_FAILED, info);
  if (httpStatus === 403) {
    if (msg.includes('insufficient')) return new BrokerError(BrokerErrorCode.INSUFFICIENT_FUNDS, info);
    return new BrokerError(BrokerErrorCode.PERMISSION_DENIED, info);
  }
  if (httpStatus === 404) return new BrokerError(BrokerErrorCode.ORDER_NOT_FOUND, info);
  if (httpStatus === 409 || (httpStatus === 422 && msg.includes('client_order_id') && msg.includes('unique'))) {
    return new BrokerError(BrokerErrorCode.DUPLICATE_CLIENT_ORDER_ID, info);
  }
  if (msg.includes('market is closed') || msg.includes('market closed')) return new BrokerError(BrokerErrorCode.MARKET_CLOSED, info);
  if (httpStatus >= 400) return new BrokerError(BrokerErrorCode.INVALID_REQUEST, info);
  return new BrokerError(BrokerErrorCode.INTERNAL, info);
}
