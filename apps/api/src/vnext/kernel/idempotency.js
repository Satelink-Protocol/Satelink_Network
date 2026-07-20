// Kernel idempotency layer (Constitution §1.3, §3).
//
// Generalizes the per-domain dedup patterns found in the audit (x402
// "already recorded" + `ON CONFLICT DO NOTHING`, settlement_evm_nonce_lock)
// into one kernel-generic mechanism: a stable per-(txId, phase) key and an
// exactly-once execution guard. A retried or replayed transaction re-attaches
// to the same txId and each phase's side effect runs at most once.

import { hashObject } from '../../utils/canonical_json.js';

/** Stable idempotency key for a phase of a transaction. */
export function idemKey(txId, phase) { return `${txId}:${phase}`; }

/** Deterministic txId from a client idempotency key, so re-submits re-attach. */
export function deriveTxId(idempotencyKey) {
  return 'tx_' + hashObject({ idempotencyKey }).slice(0, 24);
}

export class IdempotencyStore {
  constructor() { this._results = new Map(); }

  has(key) { return this._results.has(key); }

  /**
   * Run `fn` exactly once per key; later (or concurrent) callers await the same
   * result. The in-flight promise is cached SYNCHRONOUSLY before any await, so
   * two concurrent callers cannot both execute `fn` (no double side effect).
   * On rejection the key is evicted so a genuine retry can re-run.
   */
  once(key, fn) {
    if (this._results.has(key)) return this._results.get(key);
    const p = Promise.resolve().then(fn).catch((err) => { this._results.delete(key); throw err; });
    this._results.set(key, p);
    return p;
  }
}
