// Stage 30 — classify Binance Spot Testnet failures for the nightly job (see the stage 30 doc).
/**
 * Stage 30 — testnet failures are classified so a nightly red run says WHY. Binance's Spot Testnet is
 * reset from time to time (balances and orders wiped; keys may need regenerating) — that is an
 * environment event, not a code regression, and needs a human (new keys / faucet), not a retry.
 */
export function classifyTestnetFailure(e) {
  const code = e?.code; const status = e?.httpStatus; const msg = String(e?.message ?? '');
  if (code === 'AUTH_FAILED' || /-2015|-2014|-1022/.test(String(e?.venueCode ?? ''))) return 'TESTNET_KEYS_REJECTED (testnet reset suspected: regenerate keys at testnet.binance.vision and update the trading-testnet secrets)';
  if (code === 'INSUFFICIENT_FUNDS') return 'TESTNET_BALANCE_MISSING (testnet reset suspected: balances wiped)';
  if (status === 451 || status === 403 || /restricted location|451/.test(msg)) return 'TESTNET_REGION_BLOCKED (runner region refused: use a runner in a permitted region)';
  if (code === 'VENUE_UNAVAILABLE' || code === 'AMBIGUOUS' || code === 'RATE_LIMITED') return 'TESTNET_UNAVAILABLE (transient: re-run once; two failures in a row = incident)';
  return 'TESTNET_UNEXPECTED (treat as a regression until proven otherwise)';
}
