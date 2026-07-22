// Market intelligence admin API (M8). Read-only observability over the Supplier
// Intelligence Engine: rankings, price/latency/benchmark/discovery history. Admin
// auth is applied by the caller (mounted behind adminAuth); this router itself is
// pure read. It reuses the live SupplierRegistry + MarketStore.

import express from 'express';

/**
 * @param {object} deps { registry, marketStore }
 */
export function createMarketAdminRouter({ registry, marketStore } = {}) {
  const router = express.Router();
  const ready = (res) => {
    if (!registry || !marketStore) { res.status(503).json({ ok: false, error: 'market engine not active' }); return false; }
    return true;
  };

  // GET /market/rankings?workload=&limit= — suppliers ranked by reputation desc.
  router.get('/rankings', (req, res) => {
    if (!ready(res)) return;
    const filter = req.query.workload ? { workload: String(req.query.workload) } : {};
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const ranked = registry.list(filter)
      .map((s) => ({
        supplierId: s.supplierId, source: s.source || null, status: s.status,
        reputation: s.reputation, price: s.basePrice, currency: s.currency,
        latencyMs: s.latency, availability: s.availability, successRate: s.successRate ?? null,
        paymentMethods: s.paymentMethods || [], protocols: s.protocols || [],
      }))
      .sort((a, b) => (b.reputation - a.reputation) || (a.price - b.price))
      .slice(0, limit);
    res.json({ ok: true, count: ranked.length, rankings: ranked });
  });

  router.get('/price-history/:supplierId', (req, res) => {
    if (!ready(res)) return;
    res.json({ ok: true, supplierId: req.params.supplierId, history: marketStore.priceHistory(req.params.supplierId) });
  });

  router.get('/latency-history/:supplierId', (req, res) => {
    if (!ready(res)) return;
    res.json({ ok: true, supplierId: req.params.supplierId, history: marketStore.latencyHistory(req.params.supplierId) });
  });

  router.get('/benchmark-history/:supplierId', (req, res) => {
    if (!ready(res)) return;
    res.json({ ok: true, supplierId: req.params.supplierId, history: marketStore.benchmarkHistory(req.params.supplierId) });
  });

  router.get('/discovery-history', (_req, res) => {
    if (!ready(res)) return;
    res.json({ ok: true, history: marketStore.discoveryHistory() });
  });

  return router;
}
