// Upstox environments and rules (Stage 22). Verified 2026-10-05 against the official docs and by
// unauthenticated request: api-sandbox.upstox.com answers 401 (route exists) for v3 place/modify/
// cancel and v2 order details/history; /v2/user/ip, /v2/user/kill-switch and the portfolio stream
// answer 404 there, so those are fixture-tested. Production is refused while LIVE_TRADING is LOCKED.
import { isTradingFlagEnabled } from '../../flags.mjs';
import { BrokerError, BrokerErrorCode } from '../errors.mjs';

export const UPSTOX_ENVIRONMENTS = Object.freeze({
  sandbox: Object.freeze({ name: 'sandbox', orderBase: 'https://api-sandbox.upstox.com', apiBase: 'https://api-sandbox.upstox.com', userApis: false, paper: true }),
  production: Object.freeze({ name: 'production', orderBase: 'https://api-hft.upstox.com', apiBase: 'https://api.upstox.com', userApis: true, paper: false }),
});

/** OAuth authorization dialog and token endpoint (production auth host; sandbox tokens are issued in the developer console). */
export const UPSTOX_AUTHORIZE_URL = 'https://api.upstox.com/v2/login/authorization/dialog';
export const UPSTOX_TOKEN_URL = 'https://api.upstox.com/v2/login/authorization/token';
/** v3 place-order `tag` limit is 40; the Stage 17 OMS uses 20 for Upstox (conservative, fits both). */
export const UPSTOX_TAG_MAX = 40;
export const UPSTOX_SEGMENTS = Object.freeze(['NSE_EQ', 'BSE_EQ', 'NSE_FO', 'BSE_FO', 'NCD_FO', 'BCD_FO', 'MCX_FO', 'NSE_COM']);
/** After a segment is disabled it cannot be re-enabled for 12 hours (Upstox kill-switch docs). */
export const KILL_SWITCH_COOLING_MS = 12 * 3_600_000;

export function resolveEnvironment(name, env = {}) {
  const e = UPSTOX_ENVIRONMENTS[name];
  if (!e) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'upstox', message: `unknown Upstox environment ${name}` });
  if (!e.paper && !isTradingFlagEnabled('LIVE_TRADING', env)) {
    throw new BrokerError(BrokerErrorCode.PERMISSION_DENIED, { venue: 'upstox', message: 'Upstox production is refused: LIVE_TRADING is locked' });
  }
  return e;
}

/**
 * The ONLY place an X-Algo-Name header can come from. Exchange-approved algo names are for
 * automated strategies; COPILOT orders are human-confirmed and never carry one. UPSTOX_AUTOMATED
 * is LOCKED, so this returns {} today whatever the caller passes.
 */
export function algoHeaders(env = {}, algoName = null) {
  if (!isTradingFlagEnabled('UPSTOX_AUTOMATED', env) || !algoName) return {};
  return { 'X-Algo-Name': String(algoName) };
}
