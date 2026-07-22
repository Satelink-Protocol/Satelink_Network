// Supplier Registry (Constitution §5, §10) — authoritative inventory of every
// executable supplier. Nothing executes unless registered. Generic: a supplier
// is just a capability provider (no x402/RPC/AI/DEX/HTTP knowledge here).
//
// Every mutation is journaled as a full snapshot into the reused M1 Journal, so
// replaying the journal reconstructs identical supplier state. `findCandidates`
// emits the exact candidate shape the frozen DecisionEngine already consumes —
// the registry adapts to the engine's contract, never the reverse.

export const SupplierStatus = Object.freeze({
  HEALTHY: 'healthy', DEGRADED: 'degraded', MAINTENANCE: 'maintenance', OFFLINE: 'offline',
});

// Health drives availability, so a health change automatically changes selection.
const AVAILABILITY_BY_STATUS = { healthy: 1.0, degraded: 0.5, maintenance: 0.0, offline: 0.0 };
const ROUTABLE = new Set([SupplierStatus.HEALTHY, SupplierStatus.DEGRADED]);
const REQUIRED = ['supplierId', 'adapterId'];

export class SupplierRegistry {
  constructor({ journal, clock } = {}) {
    this.journal = journal; // reused M1 Journal (mutation log)
    this.clock = clock || (() => Date.now());
    this._suppliers = new Map();
  }

  _availability(status) { return AVAILABILITY_BY_STATUS[status] ?? 0; }

  _record(op, supplier) {
    if (this.journal) this.journal.append(`supplier:${supplier.supplierId}`, op, { ...supplier }, this.clock());
  }

  register(spec) {
    for (const f of REQUIRED) if (spec[f] == null) throw new Error(`supplier missing required field '${f}'`);
    const now = this.clock();
    const status = spec.status || SupplierStatus.HEALTHY;
    const s = {
      supplierId: spec.supplierId,
      adapterId: spec.adapterId,
      capabilities: spec.capabilities || [],
      supportedWorkloads: spec.supportedWorkloads || [],
      supportedSettlementModes: spec.supportedSettlementModes || [],
      supportedPaymentRails: spec.supportedPaymentRails || [],
      supportedChains: spec.supportedChains || [],
      health: spec.health || 'healthy',
      status,
      availability: this._availability(status),
      latency: spec.latency ?? 0,
      basePrice: spec.basePrice ?? 0,
      currency: spec.currency || 'USDC',
      reputation: spec.reputation ?? 50,
      version: spec.version || '1',
      offlineReason: null,
      lastHeartbeat: now,
      registeredAt: now,
      updatedAt: now,
    };
    this._suppliers.set(s.supplierId, s);
    this._record('REGISTER', s);
    return s;
  }

  unregister(supplierId) {
    const s = this._suppliers.get(supplierId);
    if (!s) return false;
    this._suppliers.delete(supplierId);
    if (this.journal) this.journal.append(`supplier:${supplierId}`, 'UNREGISTER', { supplierId }, this.clock());
    return true;
  }

  heartbeat(supplierId, { latency, ts } = {}) {
    const s = this._require(supplierId);
    s.lastHeartbeat = ts ?? this.clock();
    if (latency != null) s.latency = latency;
    // Auto-recover ONLY from a stale-heartbeat offline. An operator-set offline
    // (or maintenance) must NOT be overridden by a heartbeat.
    if (s.status === SupplierStatus.OFFLINE && s.offlineReason === 'stale') {
      s.status = SupplierStatus.HEALTHY;
      s.offlineReason = null;
      s.availability = this._availability(s.status);
    }
    s.updatedAt = this.clock();
    this._record('HEARTBEAT', s);
    return s;
  }

  updateHealth(supplierId, { status, health, reason } = {}) {
    const s = this._require(supplierId);
    if (status) {
      s.status = status;
      s.offlineReason = status === SupplierStatus.OFFLINE ? (reason || 'manual') : null;
    }
    if (health) s.health = health;
    s.availability = this._availability(s.status);
    s.updatedAt = this.clock();
    this._record('HEALTH', s);
    return s;
  }

  // --- M8 additive extensions (existing methods/behavior unchanged) ---

  // Update the routing reputation (0..100). Used by benchmark scoring + decay.
  // Feeds DecisionEngine automatically via findCandidates().reputation.
  updateReputation(supplierId, { reputation } = {}) {
    const s = this._require(supplierId);
    if (reputation != null) s.reputation = Math.max(0, Math.min(100, Number(reputation)));
    s.updatedAt = this.clock();
    this._record('REPUTATION', s);
    return s;
  }

  // Store live market metadata (payment methods, protocols, observed success
  // rate, discovery source). Additive fields only — never alters routable state
  // fields consumed by findCandidates(), so compatibility is preserved.
  updateMetadata(supplierId, { paymentMethods, protocols, successRate, source, marketMeta } = {}) {
    const s = this._require(supplierId);
    if (Array.isArray(paymentMethods)) s.paymentMethods = paymentMethods.slice();
    if (Array.isArray(protocols)) s.protocols = protocols.slice();
    if (successRate != null) s.successRate = Number(successRate);
    if (source) s.source = source;
    if (marketMeta && typeof marketMeta === 'object') s.marketMeta = { ...(s.marketMeta || {}), ...marketMeta };
    s.updatedAt = this.clock();
    this._record('METADATA', s);
    return s;
  }

  updatePrice(supplierId, { basePrice, currency } = {}) {
    const s = this._require(supplierId);
    if (basePrice != null) s.basePrice = basePrice;
    if (currency) s.currency = currency;
    s.updatedAt = this.clock();
    this._record('PRICE', s);
    return s;
  }

  /** Filter to routable suppliers matching the query, mapped to the
   *  DecisionEngine candidate contract (no engine change required). */
  findCandidates(query = {}) {
    const out = [];
    for (const s of this._suppliers.values()) {
      if (!ROUTABLE.has(s.status)) continue;
      if (query.workload && !s.supportedWorkloads.includes(query.workload)) continue;
      if (query.settlementMode && !s.supportedSettlementModes.includes(query.settlementMode)) continue;
      if (query.paymentRail && !s.supportedPaymentRails.includes(query.paymentRail)) continue;
      if (query.chain && !s.supportedChains.includes(query.chain)) continue;
      out.push({
        supplierId: s.supplierId,
        adapterId: s.adapterId,
        price: s.basePrice,
        currency: s.currency,
        latencyMs: s.latency,
        availability: s.availability,
        reputation: s.reputation,
        paymentRail: query.paymentRail || s.supportedPaymentRails[0] || null,
        settlementMode: query.settlementMode || s.supportedSettlementModes[0] || null,
      });
    }
    return out;
  }

  list(filter = {}) {
    const all = [...this._suppliers.values()];
    if (filter.status) return all.filter((s) => s.status === filter.status);
    if (filter.workload) return all.filter((s) => s.supportedWorkloads.includes(filter.workload));
    return all;
  }

  get(supplierId) { return this._suppliers.get(supplierId) || null; }

  /** Snapshot copy for comparison / replay verification. */
  snapshot() {
    const m = new Map();
    for (const [id, s] of this._suppliers) m.set(id, { ...s });
    return m;
  }

  _require(supplierId) {
    const s = this._suppliers.get(supplierId);
    if (!s) throw new Error(`unknown supplier '${supplierId}'`);
    return s;
  }
}

/** Replay: reconstruct identical supplier state from the journal alone. */
export function reconstructSuppliers(journal) {
  const map = new Map();
  for (const e of journal.all()) {
    if (!String(e.txId).startsWith('supplier:')) continue;
    const id = e.payload.supplierId;
    if (e.phase === 'UNREGISTER') map.delete(id);
    else map.set(id, { ...e.payload });
  }
  return map;
}
