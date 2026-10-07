// Alpaca Broker API environments (Stage 23). Verified 2026-10-05: the sandbox is self-serve (free
// email signup at broker-app.alpaca.markets; no agreement until going live), and
// broker-api.sandbox.alpaca.markets answers 401 unauthenticated for /v1/accounts, /v2/events/trades
// and /v1/trading/accounts/{id}/orders:by_client_order_id (routes exist). Production needs a signed
// partner agreement and is refused here while LIVE_TRADING is LOCKED.
import { isTradingFlagEnabled } from '../../flags.mjs';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';

export const ALPACA_ENVIRONMENTS = Object.freeze({
  sandbox: Object.freeze({ name: 'sandbox', base: 'https://broker-api.sandbox.alpaca.markets', paper: true }),
  production: Object.freeze({ name: 'production', base: 'https://broker-api.alpaca.markets', paper: false }),
});

/** Broker API client_order_id: ≤ 48 in the Broker API reference (the Trading API allows 128); the OMS uses 48. */
export const ALPACA_CLIENT_ID_MAX = 48;
export const CommissionType = Object.freeze({ NOTIONAL: 'notional', QTY: 'qty', BPS: 'bps' });

export function resolveEnvironment(name, env = {}) {
  const e = ALPACA_ENVIRONMENTS[name];
  if (!e) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'alpaca', message: `unknown Alpaca environment ${name}` });
  if (!e.paper && !isTradingFlagEnabled('LIVE_TRADING', env)) {
    throw new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'alpaca', message: 'Alpaca production is refused: LIVE_TRADING is locked' });
  }
  return e;
}
