// Persistent idempotency store over a DurableStore. Provides run(key, fn) with
// the same {value, fresh} contract the kernel uses, but exactly-once survives a
// process restart: the result is persisted, and insert-if-absent (PK / ON
// CONFLICT DO NOTHING) makes a phase's side effect run at most once even across
// processes. An in-process promise cache prevents concurrent same-key double
// execution within one process.

export class PersistentIdempotencyStore {
  constructor(store) {
    if (!store) throw new Error('PersistentIdempotencyStore requires a store');
    this.store = store;
    this._local = new Map(); // key -> Promise<value> (in-process concurrency guard)
  }

  async run(key, fn) {
    if (this._local.has(key)) return this._local.get(key).then((value) => ({ value, fresh: false }));

    const p = (async () => {
      const existing = await this.store.kvGet(key);
      if (existing !== null) return { value: existing, fresh: false };
      const value = await fn();
      const res = await this.store.kvSetIfAbsent(key, value);
      return { value: res.value, fresh: res.inserted };
    })();

    // Cache the value-promise synchronously so a concurrent local caller reuses
    // it. On failure evict so a genuine retry can re-run. The cached promise
    // carries its own terminal handler so a failure here never surfaces as an
    // unhandled rejection — the real error still propagates via `return p`,
    // which the caller (kernel _phase) awaits and its try/catch handles.
    const cached = p.then((r) => r.value, (err) => { this._local.delete(key); throw err; });
    cached.catch(() => {});
    this._local.set(key, cached);
    return p;
  }

  // Back-compat shims (kernel uses run()).
  async has(key) { return this._local.has(key) || (await this.store.kvGet(key)) !== null; }
  async once(key, fn) { return (await this.run(key, fn)).value; }
}
