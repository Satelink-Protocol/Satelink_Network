// Normalized, venue-agnostic broker types (Stage 10).
// Every enum is frozen; adapters map venue values INTO these and never invent new ones.

export const OrderSide = Object.freeze({ BUY: 'buy', SELL: 'sell' });

export const OrderType = Object.freeze({
  MARKET: 'market',
  LIMIT: 'limit',
  STOP: 'stop',
  STOP_LIMIT: 'stop_limit',
});

export const TimeInForce = Object.freeze({ GTC: 'gtc', IOC: 'ioc', FOK: 'fok', DAY: 'day' });

/**
 * Normalized VENUE order status (what the broker says about an order).
 * UNKNOWN is a first-class state: the venue did not tell us, or told us
 * something we cannot map. It is never guessed into another state and always
 * requires reconciliation (query by client order id) before any retry.
 */
export const BrokerOrderStatus = Object.freeze({
  PENDING_NEW: 'pending_new',          // accepted by the gateway, not yet live on the book
  ACKNOWLEDGED: 'acknowledged',        // live / working at the venue
  PARTIALLY_FILLED: 'partially_filled',
  FILLED: 'filled',
  PENDING_CANCEL: 'pending_cancel',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  UNKNOWN: 'unknown',
});

/** Terminal statuses: no further fills can arrive. */
export const TERMINAL_STATUSES = Object.freeze(new Set([
  BrokerOrderStatus.FILLED,
  BrokerOrderStatus.CANCELLED,
  BrokerOrderStatus.REJECTED,
  BrokerOrderStatus.EXPIRED,
]));

/**
 * Outcome of a submit call, independent of status.
 *   PLACED     — the venue has the order (it may still be rejected later).
 *   NOT_PLACED — the venue definitely does not have the order; safe to retry with the SAME client order id.
 *   UNKNOWN    — we cannot tell (e.g. timeout after the request was sent). Reconcile first; never blind-retry.
 */
export const SubmitOutcome = Object.freeze({ PLACED: 'placed', NOT_PLACED: 'not_placed', UNKNOWN: 'unknown' });

export const Venue = Object.freeze({ BINANCE: 'binance', UPSTOX: 'upstox', ALPACA: 'alpaca', MOCK: 'mock' });

export const AssetClass = Object.freeze({ CRYPTO_SPOT: 'crypto_spot', EQUITY: 'equity' });
