// Market history store (M8) — append-only per-supplier time series for price,
// latency, benchmarks, plus a global discovery log. Every append is also written
// to the reused vNext Journal (stream `market:<supplierId>` / `market:discovery`)
// so the full market state is deterministically replayable. In-memory ring
// buffers bound growth; the journal is the durable source of truth for replay.

const MAX_POINTS = 500; // per series, per supplier

function pushBounded(arr, point) {
  arr.push(point);
  if (arr.length > MAX_POINTS) arr.shift();
  return arr;
}

export class MarketStore {
  constructor({ journal, clock } = {}) {
    this.journal = journal || null; // reused vNext Journal (append(stream, phase, payload, ts))
    this.clock = clock || (() => Date.now());
    this._price = new Map();      // supplierId -> [{ price, currency, ts }]
    this._latency = new Map();    // supplierId -> [{ latencyMs, ts }]
    this._benchmark = new Map();  // supplierId -> [{ ...metrics, healthScore, ts }]
    this._discovery = [];         // [{ source, discovered, added, ts }]
  }

  _series(map, id) { if (!map.has(id)) map.set(id, []); return map.get(id); }
  _journal(stream, phase, payload) { if (this.journal) this.journal.append(stream, phase, payload, this.clock()); }

  recordPrice(supplierId, price, currency) {
    const ts = this.clock();
    const point = { price: String(price), currency: currency || 'USDC', ts };
    pushBounded(this._series(this._price, supplierId), point);
    this._journal(`market:${supplierId}`, 'PRICE', point);
    return point;
  }

  recordLatency(supplierId, latencyMs) {
    const ts = this.clock();
    const point = { latencyMs: Number(latencyMs), ts };
    pushBounded(this._series(this._latency, supplierId), point);
    this._journal(`market:${supplierId}`, 'LATENCY', point);
    return point;
  }

  recordBenchmark(supplierId, metrics) {
    const ts = this.clock();
    const point = { ...metrics, ts };
    pushBounded(this._series(this._benchmark, supplierId), point);
    this._journal(`market:${supplierId}`, 'BENCHMARK', point);
    return point;
  }

  recordDiscovery(source, discovered, added) {
    const ts = this.clock();
    const point = { source, discovered: Number(discovered), added: Number(added), ts };
    pushBounded(this._discovery, point);
    this._journal('market:discovery', 'DISCOVERY', point);
    return point;
  }

  priceHistory(supplierId) { return (this._price.get(supplierId) || []).slice(); }
  latencyHistory(supplierId) { return (this._latency.get(supplierId) || []).slice(); }
  benchmarkHistory(supplierId) { return (this._benchmark.get(supplierId) || []).slice(); }
  discoveryHistory() { return this._discovery.slice(); }

  /** Rebuild all series from the journal alone (deterministic replay). */
  static replay(journal, { clock } = {}) {
    const store = new MarketStore({ journal: null, clock });
    for (const e of journal.all()) {
      const id = String(e.txId || '').startsWith('market:') ? e.txId.slice('market:'.length) : null;
      if (id === 'discovery' && e.phase === 'DISCOVERY') pushBounded(store._discovery, e.payload);
      else if (id && e.phase === 'PRICE') pushBounded(store._series(store._price, id), e.payload);
      else if (id && e.phase === 'LATENCY') pushBounded(store._series(store._latency, id), e.payload);
      else if (id && e.phase === 'BENCHMARK') pushBounded(store._series(store._benchmark, id), e.payload);
    }
    return store;
  }
}
