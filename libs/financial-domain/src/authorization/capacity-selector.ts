/**
 * CapacitySelector — pure domain service. Chooses the next eligible nonce to
 * consume `amount` at `clockMs`.
 *
 * Strategy: SOONEST-EXPIRING FIRST. Among unconsumed nonces whose window
 * contains the clock (and given the authorization is active, within its window,
 * and has enough available capacity for `amount`), pick the one with the
 * smallest validBefore. Ties break by nonce value (lexicographic) so selection
 * is fully DETERMINISTIC for the same clock and nonce set. Returns null if none
 * is eligible. Selects only — it does not consume.
 */

import type { Money } from '@satelink/kernel';
import type { Authorization } from './authorization.js';
import type { NonceValue } from './nonce-value.js';

export class CapacitySelector {
  static select(authorization: Authorization, amount: Money, clockMs: number): NonceValue | null {
    if (authorization.state.isTerminal()) return null;
    if (!authorization.window.contains(clockMs)) return null;

    // amount must fit within remaining available capacity (same currency).
    const overAvailable = amount.greaterThan(authorization.available());
    if (overAvailable.isErr || overAvailable.value) return null;

    const eligible = authorization.nonces.filter(
      (n) => n.state === 'unconsumed' && n.window.contains(clockMs),
    );
    if (eligible.length === 0) return null;

    const [first] = [...eligible].sort((a, b) => {
      if (a.window.validBefore !== b.window.validBefore) {
        return a.window.validBefore - b.window.validBefore;
      }
      return a.value.value < b.value.value ? -1 : a.value.value > b.value.value ? 1 : 0;
    });
    return first ? first.value : null;
  }
}
