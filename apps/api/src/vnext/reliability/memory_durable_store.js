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
}

export { GENESIS };
