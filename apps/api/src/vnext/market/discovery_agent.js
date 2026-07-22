// DiscoveryAgent (M8) — periodically discovers suppliers from external registries
// and registers them into the REUSED SupplierRegistry (so they immediately become
// routable candidates for the M3 DecisionEngine). Every discovery round is
// journaled and recorded to the MarketStore for replay/observability.
//
// Failure isolation: one source failing (network error, bad JSON) never aborts
// the round — its error is recorded and the other sources proceed. Registration
// is idempotent-by-supplierId (register() upserts), so re-discovery is safe.

export class DiscoveryAgent {
  constructor({ registry, sources, marketStore, journal, clock, logger } = {}) {
    if (!registry) throw new Error('DiscoveryAgent requires a SupplierRegistry');
    if (!Array.isArray(sources) || sources.length === 0) throw new Error('DiscoveryAgent requires sources');
    this.registry = registry;
    this.sources = sources;
    this.marketStore = marketStore || null;
    this.journal = journal || null;
    this.clock = clock || (() => Date.now());
    this.logger = logger || { log() {}, error() {} };
  }

  /** Run one discovery pass across all sources. Returns a per-source summary. */
  async discoverOnce() {
    const summary = [];
    for (const source of this.sources) {
      let result;
      try { result = await source.discover(); }
      catch (e) { result = { source: source.name, records: [], error: String((e && e.message) || e) }; }

      let added = 0;
      for (const rec of result.records || []) {
        try {
          this.registry.register(rec); // upsert -> routable
          if (typeof this.registry.updateMetadata === 'function') {
            this.registry.updateMetadata(rec.supplierId, {
              paymentMethods: rec.paymentMethods, protocols: rec.protocols, source: rec.source,
              // Preserve the source's full market metadata (e.g. Bazaar lastUpdated,
              // payTo, serviceName, tags); fall back to url when absent.
              marketMeta: rec.marketMeta || { url: rec.url },
            });
          }
          added += 1;
        } catch (e) { this.logger.error('[m8] register failed', rec && rec.supplierId, (e && e.message) || e); }
      }

      const discovered = (result.records || []).length;
      if (this.marketStore) this.marketStore.recordDiscovery(source.name, discovered, added);
      if (this.journal) this.journal.append('market:discovery', 'DISCOVERY_SOURCE', { source: source.name, discovered, added, error: result.error || null }, this.clock());
      summary.push({ source: source.name, discovered, added, error: result.error || null });
    }
    return { ts: this.clock(), sources: summary, totalAdded: summary.reduce((n, s) => n + s.added, 0) };
  }
}
