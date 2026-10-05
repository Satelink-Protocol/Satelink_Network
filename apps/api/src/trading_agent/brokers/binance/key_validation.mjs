// API-key permission validation (Stage 21): GET /sapi/v1/account/apiRestrictions.
// A key is refused if it can move funds out or is not IP-restricted:
//   enableWithdrawals, enableInternalTransfer or permitsUniversalTransfer true → refuse
//   ipRestrict false → refuse   (keys must be bound to the execution service's static IP, B-08)
// and it must actually be able to trade spot and read (enableSpotAndMarginTrading, enableReading).
// /sapi is not available on the Spot Testnet, so this path is covered by fixture contract tests.
export const REQUIRED_FALSE = Object.freeze(['enableWithdrawals', 'enableInternalTransfer', 'permitsUniversalTransfer']);
export const REQUIRED_TRUE = Object.freeze(['ipRestrict', 'enableSpotAndMarginTrading', 'enableReading']);

export function evaluateApiRestrictions(r) {
  const violations = [];
  if (!r || typeof r !== 'object') return { ok: false, violations: ['apiRestrictions response missing'] };
  for (const k of REQUIRED_FALSE) if (r[k] !== false) violations.push(`${k} must be false (is ${JSON.stringify(r[k])})`);
  for (const k of REQUIRED_TRUE) if (r[k] !== true) violations.push(`${k} must be true (is ${JSON.stringify(r[k])})`);
  return Object.freeze({ ok: violations.length === 0, violations });
}
