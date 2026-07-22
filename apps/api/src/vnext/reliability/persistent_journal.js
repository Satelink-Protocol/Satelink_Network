// Persistent, append-only, hash-linked journal over a DurableStore (memory or
// PostgreSQL). Implements the same surface the kernel/registry use — append,
// read, all, verifyChain — plus async load() to rehydrate after a restart.
// The hash chain is computed with the SAME primitive as the in-memory M1
// Journal (sha256(canonical_json(entry)+hash_prev)), so replay is identical.

import { canonicalJSON, sha256Hex } from '../../utils/canonical_json.js';

const GENESIS = '0'.repeat(64);

export class PersistentJournal {
  constructor(store, primed = []) {
    this.store = store;
    this._chain = primed.slice(); // in-memory mirror (seq-ordered)
    this._tail = Promise.resolve(); // append serialization lock (see append)
  }

  /** Rehydrate the journal from durable storage (call on process start).
   *  Normalizes durable rows to the in-memory record shape, using the 0-based
   *  position as `seq` so the recomputed hash matches what was stored. */
  static async load(store) {
    const events = await store.allEvents();
    const primed = events.map((e, i) => ({
      seq: i, txId: e.stream_id, phase: e.phase, payload: e.payload, ts: Number(e.ts),
      hash_prev: e.hash_prev, hash_current: e.hash_current,
    }));
    return new PersistentJournal(store, primed);
  }

  // Appends are strictly serialized. A hash chain is order-dependent: the
  // read-compute-persist-push sequence must be atomic per append, or concurrent
  // callers (e.g. a fire-and-forget health mutation racing a transaction phase)
  // would both hash against the same tail and corrupt the chain. The `_tail`
  // promise chain guarantees one append completes before the next begins.
  append(streamId, phase, payload, ts) {
    const run = this._tail.then(async () => {
      const seq = this._chain.length; // matches in-memory M1 Journal seq semantics
      const hashPrev = seq === 0 ? GENESIS : this._chain[seq - 1].hash_current;
      const entry = { seq, txId: streamId, phase, payload, ts };
      const hashCurrent = sha256Hex(canonicalJSON(entry) + hashPrev);
      const durable = { stream_id: streamId, phase, payload, ts, hash_prev: hashPrev, hash_current: hashCurrent };
      await this.store.appendEvent(durable); // durable BEFORE returning (crash-safe)
      const record = { seq, txId: streamId, phase, payload, ts, hash_prev: hashPrev, hash_current: hashCurrent };
      this._chain.push(record);
      return record;
    });
    // Keep the lock chain alive even if this append rejects, without swallowing
    // the error for the caller.
    this._tail = run.then(() => {}, () => {});
    return run;
  }

  read(txId) { return this._chain.filter((e) => e.txId === txId); }
  all() { return this._chain.slice(); }

  verifyChain() {
    let prev = GENESIS;
    for (const e of this._chain) {
      const entry = { seq: e.seq, txId: e.txId, phase: e.phase, payload: e.payload, ts: e.ts };
      const expected = sha256Hex(canonicalJSON(entry) + prev);
      if (e.hash_prev !== prev || e.hash_current !== expected) return false;
      prev = e.hash_current;
    }
    return true;
  }
}

export { GENESIS };
