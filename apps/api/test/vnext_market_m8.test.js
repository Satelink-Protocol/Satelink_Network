// M8 Global Supplier Intelligence Engine — unit, integration, replay, failure.
// Reuses SupplierRegistry, Journal, DecisionEngine. DB-free.
// Run: `node --test test/vnext_market_m8.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { SupplierRegistry } from '../src/vnext/registry/supplier_registry.js';
import { Journal } from '../src/vnext/kernel/journal.js';
import { DecisionEngine } from '../src/vnext/routing/decision_engine.js';
import { Policies } from '../src/vnext/routing/policies.js';

import { computeHealthScore, decayReputation, idleDecay } from '../src/vnext/market/health_scorer.js';
import { MarketStore } from '../src/vnext/market/market_store.js';
import { createSource, createAllSources, normalize, SOURCE_NAMES } from '../src/vnext/market/sources.js';
import { DiscoveryAgent } from '../src/vnext/market/discovery_agent.js';
import { BenchmarkAgent } from '../src/vnext/market/benchmark_agent.js';
import { createMarketAdminRouter } from '../src/vnext/market/market_admin_router.js';

const clock1 = () => 1;
const jsonRes = (obj) => ({ ok: true, async json() { return obj; } });
function harness() {
  const journal = new Journal();
  const registry = new SupplierRegistry({ journal, clock: clock1 });
  const marketStore = new MarketStore({ journal, clock: clock1 });
  return { journal, registry, marketStore };
}

// ---------- UNIT: health scorer + decay ----------
test('unit: health score weights availability/success/latency/price', () => {
  const perfect = computeHealthScore({ availability: 1, successRate: 1, latencyMs: 0, price: 50, marketMedianPrice: 100 });
  assert.ok(perfect.score >= 95, `perfect should be high, got ${perfect.score}`);
  const bad = computeHealthScore({ availability: 0, successRate: 0, latencyMs: 5000, price: 400, marketMedianPrice: 100 });
  assert.ok(bad.score <= 10, `bad should be low, got ${bad.score}`);
});

test('unit: reputation decays toward observed (EMA), idle decay shrinks', () => {
  assert.equal(decayReputation(50, 100, 0.5), 75);
  assert.equal(decayReputation(80, 0, 0.5), 40);
  assert.equal(decayReputation(50, 50, 0.3), 50);   // stable
  assert.ok(idleDecay(100, 3, 0.9) < 100 && idleDecay(100, 0) === 100);
});

// ---------- UNIT: source normalization ----------
test('unit: normalize coerces heterogeneous rows; skips invalid', () => {
  const r = normalize({ id: 'x', url: 'https://m/x', price: 100, chains: ['eip155:8453'] }, 'x402scan');
  assert.equal(r.supplierId, 'x402scan:x');
  assert.equal(r.basePrice, 100);
  assert.deepEqual(r.supportedWorkloads, ['x402-purchase']);
  assert.equal(normalize({ id: 'no-url' }, 'x402scan'), null); // no url -> skipped
  assert.equal(normalize(null, 's'), null);
});

test('unit: all five sources build with distinct names', () => {
  const sources = createAllSources({ fetchFn: async () => jsonRes({}) });
  assert.deepEqual(sources.map((s) => s.name).sort(), [...SOURCE_NAMES].sort());
  assert.deepEqual([...SOURCE_NAMES].sort(), ['agentic-market', 'ampersend', 'mcp-registry', 'paysh', 'x402scan']);
});

// ---------- INTEGRATION: discovery -> registry -> decision ----------
test('integration: discovery registers suppliers; benchmark adapts DecisionEngine routing', async () => {
  const { journal, registry, marketStore } = harness();
  const src = createSource('agentic-market', { fetchFn: async () => jsonRes({ items: [{ id: 'a', url: 'https://a/x', price: 100 }, { id: 'b', url: 'https://b/x', price: 100 }] }) });
  const da = new DiscoveryAgent({ registry, sources: [src], marketStore, journal, clock: clock1 });
  const d = await da.discoverOnce();
  assert.equal(d.totalAdded, 2);
  assert.equal(registry.findCandidates({ workload: 'x402-purchase' }).length, 2);

  // Benchmark: 'b' is much faster + cheaper -> should win latency/cheapest routing.
  const prober = async (s) => ({ ok: true, latencyMs: s.supplierId.endsWith(':b') ? 10 : 400, price: s.supplierId.endsWith(':b') ? 40 : 100, successRate: 1, availability: 1 });
  const ba = new BenchmarkAgent({ registry, marketStore, journal, prober, clock: clock1 });
  await ba.benchmarkOnce();

  const cands = registry.findCandidates({ workload: 'x402-purchase' });
  assert.equal(new DecisionEngine({ clock: clock1 }).select(cands, Policies.cheapest).chosen.supplierId, 'agentic-market:b');
  assert.equal(new DecisionEngine({ clock: clock1 }).select(cands, Policies.lowestLatency).chosen.supplierId, 'agentic-market:b');
});

test('integration: failed benchmark degrades supplier + decays reputation', async () => {
  const { journal, registry, marketStore } = harness();
  registry.register({ supplierId: 's1', adapterId: 'x402-purchase', supportedWorkloads: ['x402-purchase'], supportedSettlementModes: ['PRE'], supportedPaymentRails: ['x402'], basePrice: 100, reputation: 80 });
  const ba = new BenchmarkAgent({ registry, marketStore, journal, prober: async () => ({ ok: false, error: 'timeout' }), clock: clock1, alpha: 0.5 });
  await ba.benchmarkOnce();
  const s = registry.get('s1');
  assert.equal(s.status, 'degraded');
  assert.equal(s.reputation, 40); // decayReputation(80, 0, 0.5)
});

// ---------- REPLAY ----------
test('replay: market state reconstructs from the journal alone', async () => {
  const { journal, registry, marketStore } = harness();
  const src = createSource('x402scan', { fetchFn: async () => jsonRes({ resources: [{ id: 'r', url: 'https://r/x', price: 100 }] }) });
  await new DiscoveryAgent({ registry, sources: [src], marketStore, journal, clock: clock1 }).discoverOnce();
  await new BenchmarkAgent({ registry, marketStore, journal, prober: async (s) => ({ ok: true, latencyMs: 20, price: 90, successRate: 1, availability: 1 }), clock: clock1 }).benchmarkOnce();

  assert.equal(journal.verifyChain(), true);
  const replayed = MarketStore.replay(journal);
  assert.deepEqual(replayed.priceHistory('x402scan:r'), marketStore.priceHistory('x402scan:r'));
  assert.deepEqual(replayed.latencyHistory('x402scan:r'), marketStore.latencyHistory('x402scan:r'));
  assert.deepEqual(replayed.benchmarkHistory('x402scan:r'), marketStore.benchmarkHistory('x402scan:r'));
  assert.equal(replayed.discoveryHistory().length, marketStore.discoveryHistory().length);
});

// ---------- FAILURE ISOLATION ----------
test('failure: one source erroring does not abort discovery of the others', async () => {
  const { journal, registry, marketStore } = harness();
  const good = createSource('paysh', { fetchFn: async () => jsonRes({ services: [{ id: 'g', url: 'https://g/x', price: 50 }] }) });
  const boomHttp = createSource('ampersend', { fetchFn: async () => ({ ok: false, status: 503 }) });
  const boomThrow = createSource('mcp-registry', { fetchFn: async () => { throw new Error('DNS'); } });
  const badJson = createSource('x402scan', { fetchFn: async () => ({ ok: true, async json() { throw new Error('bad'); } }) });
  const da = new DiscoveryAgent({ registry, sources: [good, boomHttp, boomThrow, badJson], marketStore, journal, clock: clock1 });
  const d = await da.discoverOnce();
  assert.equal(d.totalAdded, 1); // only the good source registered
  assert.equal(registry.get('paysh:g') != null, true);
  const errs = d.sources.filter((s) => s.error).map((s) => s.source).sort();
  assert.deepEqual(errs, ['ampersend', 'mcp-registry', 'x402scan']);
});

test('failure: malformed rows in a source are skipped, valid ones kept', async () => {
  const { journal, registry, marketStore } = harness();
  const src = createSource('agentic-market', { fetchFn: async () => jsonRes({ items: [{ id: 'ok', url: 'https://ok/x', price: 10 }, { garbage: true }, null, { id: 'nourl' }] }) });
  const d = await new DiscoveryAgent({ registry, sources: [src], marketStore, journal, clock: clock1 }).discoverOnce();
  assert.equal(d.totalAdded, 1);
});

// ---------- ADMIN API ----------
test('admin API: rankings + histories reflect discovered/benchmarked state', async () => {
  const { journal, registry, marketStore } = harness();
  const src = createSource('agentic-market', { fetchFn: async () => jsonRes({ items: [{ id: 'a', url: 'https://a/x', price: 100 }, { id: 'b', url: 'https://b/x', price: 50 }] }) });
  await new DiscoveryAgent({ registry, sources: [src], marketStore, journal, clock: clock1 }).discoverOnce();
  await new BenchmarkAgent({ registry, marketStore, journal, prober: async (s) => ({ ok: true, latencyMs: 15, price: s.basePrice, successRate: 1, availability: 1 }), clock: clock1 }).benchmarkOnce();

  const app = express();
  app.use('/market', createMarketAdminRouter({ registry, marketStore }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const port = srv.address().port;
  try {
    const rankings = await (await fetch(`http://127.0.0.1:${port}/market/rankings?workload=x402-purchase`)).json();
    assert.equal(rankings.ok, true);
    assert.equal(rankings.count, 2);
    assert.ok(rankings.rankings[0].reputation >= rankings.rankings[1].reputation); // ranked desc

    const ph = await (await fetch(`http://127.0.0.1:${port}/market/price-history/agentic-market:b`)).json();
    assert.ok(ph.history.length >= 1);
    const lh = await (await fetch(`http://127.0.0.1:${port}/market/latency-history/agentic-market:b`)).json();
    assert.equal(lh.history[0].latencyMs, 15);
    const bh = await (await fetch(`http://127.0.0.1:${port}/market/benchmark-history/agentic-market:b`)).json();
    assert.ok(bh.history[0].healthScore > 0);
    const dh = await (await fetch(`http://127.0.0.1:${port}/market/discovery-history`)).json();
    assert.equal(dh.history[0].source, 'agentic-market');
  } finally { srv.close(); }
});

// ---------- COMPATIBILITY: additive registry methods don't break routable state ----------
test('compat: updateMetadata/updateReputation are additive (routable fields intact)', () => {
  const { registry } = harness();
  registry.register({ supplierId: 's', adapterId: 'x402-purchase', supportedWorkloads: ['x402-purchase'], supportedSettlementModes: ['PRE'], supportedPaymentRails: ['x402'], basePrice: 100, reputation: 50 });
  registry.updateMetadata('s', { paymentMethods: ['x402'], protocols: ['x402'], successRate: 0.99, source: 'x402scan' });
  registry.updateReputation('s', { reputation: 70 });
  const c = registry.findCandidates({ workload: 'x402-purchase' })[0];
  assert.equal(c.price, 100);       // routable field unchanged
  assert.equal(c.reputation, 70);   // reputation updated -> feeds DecisionEngine
  assert.equal(registry.get('s').successRate, 0.99);
});
