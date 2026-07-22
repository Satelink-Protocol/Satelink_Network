// Durable Supplier Registry — composition wrapper around the M4 SupplierRegistry
// (M4 logic is NOT modified). Each mutating call is delegated to the real
// registry, then the resulting snapshot is persisted to the DurableStore
// (awaited, so it is committed before the call returns). On restart, load()
// rehydrates every supplier from the store. Read/candidate methods pass through
// unchanged, so the wrapper is a drop-in for the kernel's supplierRegistry.

import { SupplierRegistry } from '../registry/supplier_registry.js';

const MUTATORS = ['register', 'heartbeat', 'updateHealth', 'updatePrice'];

export class PersistentSupplierRegistry {
  constructor({ store, journal, clock } = {}) {
    if (!store) throw new Error('PersistentSupplierRegistry requires a store');
    this.store = store;
    this.clock = clock || (() => Date.now());
    this.inner = new SupplierRegistry({ journal, clock: this.clock });
  }

  /** Rebuild in-memory registry state from durable snapshots after a restart. */
  static async load({ store, journal, clock } = {}) {
    const reg = new PersistentSupplierRegistry({ store, journal, clock });
    for (const row of await store.supplierAll()) {
      // Re-register from the durable snapshot; snapshot carries full metadata.
      reg.inner.register(row.snapshot);
    }
    return reg;
  }

  async _persist(id) {
    const s = this.inner.get(id);
    if (s) await this.store.supplierUpsert(id, { ...s }, this.clock());
  }

  async register(spec) { const s = this.inner.register(spec); await this._persist(s.supplierId); return s; }
  async heartbeat(id, opts) { const s = this.inner.heartbeat(id, opts); await this._persist(id); return s; }
  async updateHealth(id, opts) { const s = this.inner.updateHealth(id, opts); await this._persist(id); return s; }
  async updatePrice(id, opts) { const s = this.inner.updatePrice(id, opts); await this._persist(id); return s; }
  async unregister(id) { const ok = this.inner.unregister(id); await this.store.supplierDelete(id); return ok; }

  // Read pass-throughs (synchronous, used by the kernel DISCOVER phase).
  findCandidates(q) { return this.inner.findCandidates(q); }
  list(f) { return this.inner.list(f); }
  get(id) { return this.inner.get(id); }
  snapshot() { return this.inner.snapshot(); }
}
