// Binance Spot environments (Stage 21). URLs verified 2026-10-05 against the official docs
// and by request (U6): testnet.binance.vision REST answered 200 with exchangeInfo, and
// demo-api.binance.com answered 200 too; the Spot Testnet is the one this adapter targets.
// Production is listed for completeness but REFUSED unless LIVE_TRADING is enabled, which
// is LOCKED (flags.mjs) — so no production Binance call can be made from this code today.
import { isTradingFlagEnabled } from '../../flags.mjs';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';

export const BINANCE_ENVIRONMENTS = Object.freeze({
  testnet: Object.freeze({ name: 'testnet', rest: 'https://testnet.binance.vision', wsApi: 'wss://ws-api.testnet.binance.vision/ws-api/v3', sapi: false, paper: true }),
  production: Object.freeze({ name: 'production', rest: 'https://api.binance.com', wsApi: 'wss://ws-api.binance.com:443/ws-api/v3', sapi: true, paper: false }),
});

/** Binance newClientOrderId rule (official docs / venue validation). */
export const BINANCE_CLIENT_ID_RE = /^[.A-Z:/a-z0-9_-]{1,36}$/;
export const BINANCE_CLIENT_ID_MAX = 36;
/** Binance Link ID ("x-" prefix attributes the order to the Link / broker program). */
export const LINK_ID_RE = /^[A-Za-z0-9]{4,16}$/;

/** Resolve an environment; production requires the LOCKED LIVE_TRADING flag. */
export function resolveEnvironment(name, env = {}) {
  const e = BINANCE_ENVIRONMENTS[name];
  if (!e) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'binance', message: `unknown Binance environment ${name}` });
  if (!e.paper && !isTradingFlagEnabled('LIVE_TRADING', env)) {
    throw new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'binance', message: 'Binance production is refused: LIVE_TRADING is locked' });
  }
  return e;
}
