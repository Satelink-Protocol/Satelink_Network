// BenchmarkAgent (M8) — continuously measures each registered supplier and folds
// the results back into the REUSED SupplierRegistry, so the M3 DecisionEngine
// automatically adapts routing to live market conditions (findCandidates() reads
// the updated price/latency/availability/reputation). Every measurement is
// recorded to the MarketStore and journaled for replay.
//
// The `prober` is the injected boundary: prober(supplier) -> {
//   ok, latencyMs, price, currency, successRate, availability,
//   paymentMethods?, protocols?
// }  (a real prober issues a cheap probe / reads the merchant 402; tests stub it).
//
// Health/decay: each round computes a health score from observed metrics and
// decays reputation toward it (EMA). A supplier whose probe FAILS is marked
// degraded/offline and its reputation decays downward — never silently trusted.

import { computeHealthScore, decayReputation } from './health_scorer.js';

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export class BenchmarkAgent {
  constructor({ registry, marketStore, journal, prober, clock, alpha = 0.3, logger } = {}) {
    if (!registry) throw new Error('BenchmarkAgent requires a SupplierRegistry');
    if (typeof prober !== 'function') throw new Error('BenchmarkAgent requires a prober(supplier) function');
    this.registry = registry;
    this.marketStore = marketStore || null;
    this.journal = journal || null;
    this.prober = prober;
    this.clock = clock || (() => Date.now());
    this.alpha = alpha;
    this.logger = logger || { log() {}, error() {} };
  }

  /** Probe every supplier once; update the registry + history. */
  async benchmarkOnce(query = {}) {
    const suppliers = this.registry.list(query.workload ? { workload: query.workload } : {});
    // First pass: probe all, collect results (for market-median price scoring).
    const results = [];
    for (const s of suppliers) {
      let r;
      try { r = await this.prober(s); }
      catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
      results.push({ supplier: s, r });
    }
    const marketMedianPrice = median(results.filter((x) => x.r && x.r.ok).map((x) => Number(x.r.price)));

    const report = [];
    for (const { supplier: s, r } of results) {
      const id = s.supplierId;
      if (!r || r.ok !== true) {
        // Failed probe: degrade + decay reputation downward.
        this.registry.updateHealth(id, { status: 'degraded', health: 'degraded', reason: 'benchmark_fail' });
        const decayed = decayReputation(s.reputation, 0, this.alpha);
        this.registry.updateReputation(id, { reputation: decayed });
        const metrics = { ok: false, error: (r && r.error) || 'probe_failed', healthScore: 0, reputation: decayed };
        // MarketStore.recordBenchmark journals the market series; registry
        // mutations journal supplier state. No extra append (avoids double-write).
        if (this.marketStore) this.marketStore.recordBenchmark(id, metrics);
        report.push({ supplierId: id, ...metrics });
        continue;
      }

      // Healthy probe: fold metrics into the registry (auto-adapts DecisionEngine).
      const availability = r.availability != null ? Number(r.availability) : 1;
      const successRate = r.successRate != null ? Number(r.successRate) : 1;
      if (r.price != null) this.registry.updatePrice(id, { basePrice: Number(r.price), currency: r.currency || s.currency });
      if (r.latencyMs != null) this.registry.heartbeat(id, { latency: Number(r.latencyMs) });
      this.registry.updateHealth(id, { status: availability >= 0.5 ? 'healthy' : 'degraded', health: 'healthy' });
      if (r.paymentMethods || r.protocols || r.successRate != null) {
        this.registry.updateMetadata(id, { paymentMethods: r.paymentMethods, protocols: r.protocols, successRate });
      }

      const { score, breakdown } = computeHealthScore({ availability, successRate, latencyMs: r.latencyMs, price: r.price, marketMedianPrice });
      const newRep = decayReputation(s.reputation, score, this.alpha);
      this.registry.updateReputation(id, { reputation: newRep });

      const metrics = { ok: true, price: r.price != null ? String(r.price) : null, latencyMs: r.latencyMs ?? null, availability, successRate, healthScore: score, reputation: newRep, breakdown };
      if (this.marketStore) {
        if (r.price != null) this.marketStore.recordPrice(id, r.price, r.currency || s.currency);
        if (r.latencyMs != null) this.marketStore.recordLatency(id, r.latencyMs);
        this.marketStore.recordBenchmark(id, metrics);
      }
      report.push({ supplierId: id, ...metrics });
    }
    return { ts: this.clock(), marketMedianPrice: Number.isFinite(marketMedianPrice) ? marketMedianPrice : null, results: report };
  }
}
