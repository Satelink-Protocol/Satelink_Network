// Daily Binance API-key re-check (Stage 28, option 1).
//
// A key that passed validation on connect can be widened later on Binance's side (withdrawals or
// transfers enabled, IP restriction removed). Once a day, every active Binance credential is
// re-checked with GET /sapi/v1/account/apiRestrictions through the Stage 21 rules
// (brokers/binance/key_validation.mjs). Any violation — or a re-check that cannot run — engages the
// broker_account kill switch as SYSTEM, so no order can be placed with that key until a human
// reviews it (releasing needs admin step-up: 'broker_key.recheck_override').
// This module is one deterministic run; the bot runner (Phase 6 item 10) schedules it.
import { evaluateApiRestrictions } from '../brokers/binance/key_validation.mjs';

export const SYSTEM_ACTOR = Object.freeze({ kind: 'platform', principalId: 'prn_system_key_recheck' });

/**
 * @param deps.accounts      async () => [{ brokerAccountId, principalId }]  (active Binance credentials)
 * @param deps.fetchRestrictions async (brokerAccountId) => apiRestrictions JSON (signed request via the execution service)
 * @param deps.killSwitch    KillSwitchService
 * @param deps.alert         async ({ brokerAccountId, principalId, violations }) => void
 */
export async function runDailyKeyRecheck({ accounts, fetchRestrictions, killSwitch, alert, clock = () => new Date() }) {
  const results = [];
  for (const a of await accounts()) {
    let verdict;
    try {
      verdict = evaluateApiRestrictions(await fetchRestrictions(a.brokerAccountId));
    } catch (e) {
      verdict = { ok: false, violations: [`re-check failed: ${e?.code ?? e?.name ?? 'error'}`] };
    }
    if (!verdict.ok) {
      await killSwitch.engage({
        actor: SYSTEM_ACTOR, scopeType: 'broker_account', scopeId: a.brokerAccountId, principalId: a.principalId,
        reason: `daily key re-check failed: ${verdict.violations.join('; ')}`.slice(0, 500),
      });
      await alert({ brokerAccountId: a.brokerAccountId, principalId: a.principalId, violations: verdict.violations });
    }
    results.push(Object.freeze({ brokerAccountId: a.brokerAccountId, ok: verdict.ok, violations: verdict.violations }));
  }
  return Object.freeze({ at: clock().toISOString(), checked: results.length, failed: results.filter((r) => !r.ok).length, results });
}
