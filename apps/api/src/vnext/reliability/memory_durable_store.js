// In-memory durable store — the reference implementation of the DurableStore
// interface. "Durable" here means the backing state object survives a simulated
// process restart: tests hold the backing object, tear down all in-process
// components, and rebuild them against the SAME backing — modelling the DB
// outliving the process. The PG implementation (pg_durable_store.js) satisfies
// the identical interface for production.
//
// Interface (all sync here; PG version is async — callers await both):
//   appendEvent({stream_id, phase, payload, ts, hash_prev, hash_current}) -> record
//   readStream(stream_id) -> record[]      (ordered by seq)
//   allEvents() -> record[]                (ordered by seq)
//   lastHash() -> string                   (hash_current of the last event, or GENESIS)
//   kvGet(key) -> value|null
//   kvSet(key, value) -> void              (insert-if-absent; returns existing on conflict)
//   supplierUpsert(id, snapshot, ts) / supplierDelete(id) / supplierAll()
//   dlqAdd(entry) / dlqAll() / dlqGet(txId)

const GENESIS = '0'.repeat(64);

export function createMemoryBacking() {
  return { events: [], kv: new Map(), suppliers: new Map(), dlq: new Map() };
}

export class MemoryDurableStore {
  constructor(backing) { this.b = backing || createMemoryBacking(); }

  async appendEvent(ev) {
    const seq = this.b.events.length + 1;
    const record = { seq, ...ev };
    this.b.events.push(record);
    return record;
  }
  async readStream(streamId) { return this.b.events.filter((e) => e.stream_id === streamId); }
  async allEvents() { return this.b.events.slice(); }
  async lastHash() { return this.b.events.length ? this.b.events[this.b.events.length - 1].hash_current : GENESIS; }

  async kvGet(key) { return this.b.kv.has(key) ? this.b.kv.get(key) : null; }
  // Insert-if-absent. Returns {inserted, value}. Atomic within Node's single thread.
  async kvSetIfAbsent(key, value) {
    if (this.b.kv.has(key)) return { inserted: false, value: this.b.kv.get(key) };
    this.b.kv.set(key, value);
    return { inserted: true, value };
  }

  async supplierUpsert(id, snapshot, ts) { this.b.suppliers.set(id, { snapshot, updated_at: ts }); }
  async supplierDelete(id) { this.b.suppliers.delete(id); }
  async supplierAll() { return [...this.b.suppliers.entries()].map(([id, v]) => ({ supplier_id: id, ...v })); }

  async dlqAdd(entry) { this.b.dlq.set(entry.tx_id, entry); }
  async dlqAll() { return [...this.b.dlq.values()]; }
  async dlqGet(txId) { return this.b.dlq.get(txId) || null; }

  // Outbound-payment ledger (exactly-once by idem_key).
  async outboundAdd(entry) {
    if (!this.b.outbound) this.b.outbound = new Map();
    if (this.b.outbound.has(entry.idem_key)) return { inserted: false, entry: this.b.outbound.get(entry.idem_key) };
    this.b.outbound.set(entry.idem_key, entry);
    return { inserted: true, entry };
  }
  async outboundGet(idemKey) { return (this.b.outbound && this.b.outbound.get(idemKey)) || null; }
  async outboundRowsSince(ts) {
    if (!this.b.outbound) return [];
    return [...this.b.outbound.values()].filter((e) => e.ts >= ts).map((e) => ({ amount: e.amount, ts: e.ts }));
  }

  // Treasury revenue ledger (exactly-once by tx_id).
  async treasuryAdd(entry) {
    if (!this.b.treasury) this.b.treasury = new Map();
    if (this.b.treasury.has(entry.tx_id)) return { inserted: false, entry: this.b.treasury.get(entry.tx_id) };
    this.b.treasury.set(entry.tx_id, entry);
    return { inserted: true, entry };
  }
  async treasuryGet(txId) { return (this.b.treasury && this.b.treasury.get(txId)) || null; }

  // Withdrawal ledger (exactly-once by idem_key).
  async withdrawalAdd(entry) {
    if (!this.b.withdrawal) this.b.withdrawal = new Map();
    if (this.b.withdrawal.has(entry.idem_key)) return { inserted: false, entry: this.b.withdrawal.get(entry.idem_key) };
    this.b.withdrawal.set(entry.idem_key, entry);
    return { inserted: true, entry };
  }
  async withdrawalGet(idemKey) { return (this.b.withdrawal && this.b.withdrawal.get(idemKey)) || null; }
  async treasuryRows(unit) {
    if (!this.b.treasury) return [];
    return [...this.b.treasury.values()].filter((e) => !unit || e.unit === unit);
  }

  // Single-process: the advisory lock is held on the shared backing so two
  // MemoryDurableStore instances over the SAME backing (modelling two workers)
  // still serialize — mirroring the PG advisory-lock semantics for tests.
  async withAdvisoryLock(key, fn) {
    if (!this.b.locks) this.b.locks = new Set();
    if (this.b.locks.has(key)) return { ran: false, result: null };
    this.b.locks.add(key);
    try { return { ran: true, result: await fn() }; }
    finally { this.b.locks.delete(key); }
  }
}

export { GENESIS };
