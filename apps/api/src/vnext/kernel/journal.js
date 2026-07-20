// Transaction Journal + Event Store (Constitution §2, §11).
//
// Append-only, hash-linked, tamper-evident. This reuses the EXACT technique of
// the existing production ledger `economic_ledger_chain`
// (hash_current = sha256(canonical_json(entry) + hash_prev)) via the existing
// canonical_json primitive — generalized from economics entries to per-phase
// transaction events. In-memory store for M1 (no DB redesign / no infra change);
// the hash-chain shape is storage-agnostic and binds later to a pg store.

import { canonicalJSON, sha256Hex } from '../../utils/canonical_json.js';

const GENESIS = '0'.repeat(64);

export class Journal {
  constructor() {
    /** @type {Array<object>} global append-only chain */
    this._events = [];
    /** @type {Map<string, Array<object>>} per-transaction index */
    this._byTx = new Map();
  }

  /** Append one phase event; returns the sealed record. */
  append(txId, phase, payload, ts) {
    const seq = this._events.length;
    const hashPrev = seq === 0 ? GENESIS : this._events[seq - 1].hash_current;
    const entry = { seq, txId, phase, payload, ts };
    const hashCurrent = sha256Hex(canonicalJSON(entry) + hashPrev);
    const record = { ...entry, hash_prev: hashPrev, hash_current: hashCurrent };
    this._events.push(record);
    if (!this._byTx.has(txId)) this._byTx.set(txId, []);
    this._byTx.get(txId).push(record);
    return record;
  }

  /** Ordered events for one transaction (Constitution §1.6 reconstructability). */
  read(txId) { return (this._byTx.get(txId) || []).slice(); }

  all() { return this._events.slice(); }

  /** Recompute the whole chain and confirm no entry was altered or reordered. */
  verifyChain() {
    let prev = GENESIS;
    for (const e of this._events) {
      const entry = { seq: e.seq, txId: e.txId, phase: e.phase, payload: e.payload, ts: e.ts };
      const expected = sha256Hex(canonicalJSON(entry) + prev);
      if (e.hash_prev !== prev || e.hash_current !== expected) return false;
      prev = e.hash_current;
    }
    return true;
  }
}
