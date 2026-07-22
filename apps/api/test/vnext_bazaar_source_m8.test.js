// CDP x402 Bazaar source (M8) — deterministic tests against a CAPTURED REAL
// response fixture (schema verified live 2026-07-22). Network is stubbed; parsing
// + integration with the real M8 DiscoveryAgent/registry/DecisionEngine are real.
// Run: `node --test test/vnext_bazaar_source_m8.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createBazaarSource, normalizeItem } from '../src/vnext/market/bazaar_source.js';
import { SupplierRegistry } from '../src/vnext/registry/supplier_registry.js';
import { Journal } from '../src/vnext/kernel/journal.js';
import { MarketStore } from '../src/vnext/market/market_store.js';
import { DiscoveryAgent } from '../src/vnext/market/discovery_agent.js';
import { DecisionEngine } from '../src/vnext/routing/decision_engine.js';
import { Policies } from '../src/vnext/routing/policies.js';

// Captured from the live CDP Bazaar (real schema/fields, trimmed).
const REAL_FIXTURE = {
  items: [
    { resource: 'https://mail.cusethejuice.com/admin-api/machine/mailboxes/:email/search', serviceName: 'CuseTheJuice Agent Email', description: 'agent email on Base USDC', tags: ['email', 'agent'], type: 'http', lastUpdated: '2026-07-01T17:17:55.791Z',
      accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '10000', payTo: '0xF9905a9c4784533c8cee3487b4546ed03126DcA5', extra: { name: 'USD Coin', version: '2' }, maxTimeoutSeconds: 300 }] },
    { resource: 'https://api.onesource.io/api/chain/block-number', serviceName: 'OneSource RPC', type: 'http', lastUpdated: '2026-07-20T00:00:00.000Z',
      accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000', payTo: '0xOneSource', extra: { name: 'USD Coin', version: '2' } }] },
    // Solana exact -> wrong network for Base target, skipped
    { resource: 'https://solthing/x', serviceName: 'Sol', type: 'http', accepts: [{ scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', asset: 'EPjF', amount: '500' }] },
    // batch-settlement scheme -> not exact, skipped
    { resource: 'https://batch/x', serviceName: 'Batch', type: 'http', accepts: [{ scheme: 'batch-settlement', network: 'eip155:8453', amount: '200' }] },
    // no price -> skipped
    { resource: 'https://free/x', serviceName: 'Free', type: 'http', accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '0' }] },
    // no callable url -> skipped
    { serviceName: 'NoUrl', type: 'http', accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '100' }] },
    null, // garbage row -> skipped
  ],
};
const stubFetch = (body) => async () => ({ ok: true, async json() { return body; } });

test('normalizeItem: maps the real schema (amount, extra, resource, lastUpdated)', () => {
  const r = normalizeItem(REAL_FIXTURE.items[0], 'eip155:8453');
  assert.equal(r.supplierId, 'cdp-bazaar:CuseTheJuiceAgentEmail');
  assert.equal(r.url, 'https://mail.cusethejuice.com/admin-api/machine/mailboxes/:email/search');
  assert.equal(r.basePrice, 10000);
  assert.equal(r.currency, 'USDC');
  assert.deepEqual(r.supportedChains, ['eip155:8453']);
  assert.equal(r.marketMeta.payTo, '0xF9905a9c4784533c8cee3487b4546ed03126DcA5');
  assert.equal(r.marketMeta.lastUpdated, '2026-07-01T17:17:55.791Z');
});

test('source.discover: keeps only priced Base-USDC exact; skips others', async () => {
  const src = createBazaarSource({ fetchFn: stubFetch(REAL_FIXTURE) });
  const { records, error } = await src.discover();
  assert.equal(error, undefined);
  assert.equal(records.length, 2); // CuseTheJuice + OneSource (Sol/batch/free/no-url/null skipped)
  assert.deepEqual(records.map((r) => r.supplierId).sort(), ['cdp-bazaar:CuseTheJuiceAgentEmail', 'cdp-bazaar:OneSourceRPC']);
});

test('integration: DiscoveryAgent registers real Bazaar suppliers; DecisionEngine routes cheapest', async () => {
  const journal = new Journal();
  const registry = new SupplierRegistry({ journal, clock: () => 1 });
  const marketStore = new MarketStore({ journal, clock: () => 1 });
  const src = createBazaarSource({ fetchFn: stubFetch(REAL_FIXTURE) });
  const d = await new DiscoveryAgent({ registry, sources: [src], marketStore, journal, clock: () => 1 }).discoverOnce();
  assert.equal(d.totalAdded, 2);

  const cands = registry.findCandidates({ workload: 'x402-purchase' });
  assert.equal(cands.length, 2);
  const cheapest = new DecisionEngine({ clock: () => 1 }).select(cands, Policies.cheapest);
  assert.equal(cheapest.chosen.supplierId, 'cdp-bazaar:OneSourceRPC'); // 1000 < 10000
  // metadata (payTo/lastUpdated) stored via updateMetadata
  assert.equal(registry.get('cdp-bazaar:OneSourceRPC').marketMeta.lastUpdated, '2026-07-20T00:00:00.000Z');
});

test('failure: http error / bad json -> empty records with error, no throw', async () => {
  const httpErr = createBazaarSource({ fetchFn: async () => ({ ok: false, status: 503 }) });
  assert.match((await httpErr.discover()).error, /http_503/);
  const badJson = createBazaarSource({ fetchFn: async () => ({ ok: true, async json() { throw new Error('x'); } }) });
  assert.equal((await badJson.discover()).error, 'bad_json');
  const netErr = createBazaarSource({ fetchFn: async () => { throw new Error('DNS'); } });
  assert.match((await netErr.discover()).error, /fetch_error/);
});

test('network target: only records on the requested network are kept', async () => {
  const polygonOnly = createBazaarSource({ fetchFn: stubFetch({ items: [
    { resource: 'https://p/x', serviceName: 'P', accepts: [{ scheme: 'exact', network: 'eip155:137', amount: '5', extra: { name: 'USD Coin' } }] },
    { resource: 'https://b/x', serviceName: 'B', accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '5' }] },
  ] }), network: 'eip155:137' });
  const { records } = await polygonOnly.discover();
  assert.equal(records.length, 1);
  assert.equal(records[0].supplierId, 'cdp-bazaar:P');
});
