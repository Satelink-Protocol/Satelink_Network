// RPC workload adapter (self-supply) — unit + kernel integration. Upstream node
// is the injected fetch boundary; no live node needed.
// Run: `node --test test/vnext_rpc_adapter_m8.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RpcWorkloadAdapter } from '../src/vnext/adapters/rpc/rpc_workload_adapter.js';
import { RoutingKernel } from '../src/vnext/kernel/kernel.js';
import { Journal } from '../src/vnext/kernel/journal.js';
import { IdempotencyStore, deriveTxId } from '../src/vnext/kernel/idempotency.js';
import { Registry } from '../src/vnext/kernel/registry.js';
import { SettlementAdapter, SettlementMode, ExecutionSafety } from '../src/vnext/kernel/interfaces.js';
import { DecisionEngine } from '../src/vnext/routing/decision_engine.js';
import { Policies } from '../src/vnext/routing/policies.js';
import { FeeEngine } from '../src/vnext/fees/fee_engine.js';
import { TxState } from '../src/vnext/kernel/transaction.js';

const upstreamOk = async (_url, opts) => {
  const body = JSON.parse(opts.body);
  return { status: 200, async json() { return { jsonrpc: '2.0', id: body.id, result: '0x56775ef' }; } };
};
const adapter = (over = {}) => new RpcWorkloadAdapter({ chains: ['polygon', 'ethereum'], fetchFn: upstreamOk, providerFor: () => ({ url: 'https://node/x' }), ...over });

test('capabilities: self-supply POST, AT_MOST_ONCE (never auto-retry writes)', () => {
  const c = adapter().capabilities();
  assert.equal(c.key, 'rpc');
  assert.equal(c.settlementMode, SettlementMode.POST);
  assert.equal(c.executionSafety, ExecutionSafety.AT_MOST_ONCE);
});

test('discover: one candidate per chain; chain filter works', async () => {
  const all = await adapter().discover({});
  assert.deepEqual(all.map((s) => s.supplierId).sort(), ['satelink-rpc:ethereum', 'satelink-rpc:polygon']);
  const one = await adapter().discover({ chain: 'polygon' });
  assert.equal(one.length, 1);
  assert.equal(one[0].supplierId, 'satelink-rpc:polygon');
});

test('quote: self-supply cost is non-zero internal price', async () => {
  const q = await adapter({ unitPriceMinor: 3 }).quote({}, { supplierId: 'satelink-rpc:polygon', chain: 'polygon' });
  assert.equal(q.cost, 3);
  assert.equal(q.unit, 'USDC');
});

test('execute: proxies the JSON-RPC body to the upstream node and returns result', async () => {
  const r = await adapter().execute({ payload: { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 7 } }, { supplierId: 'satelink-rpc:polygon', chain: 'polygon' }, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.result, '0x56775ef');
  assert.equal(r.body.id, 7);
  assert.equal(r.method, 'eth_blockNumber');
});

test('execute: missing body -> 400; no upstream -> 502', async () => {
  assert.equal((await adapter().execute({}, { chain: 'polygon' }, {})).status, 400);
  const noUp = adapter({ providerFor: () => null });
  assert.equal((await noUp.execute({ payload: { method: 'eth_call' } }, { chain: 'polygon' }, {})).status, 502);
});

test('execute: write method blocked unless allowWrites (safety)', async () => {
  const r = await adapter().execute({ payload: { jsonrpc: '2.0', method: 'eth_sendRawTransaction', params: ['0x..'], id: 1 } }, { supplierId: 'satelink-rpc:polygon', chain: 'polygon' }, {});
  assert.equal(r.status, 403);
  assert.equal(r.error, 'write_method_disabled');
  const allowed = await adapter().execute({ payload: { jsonrpc: '2.0', method: 'eth_sendRawTransaction', params: ['0x..'], id: 1 }, allowWrites: true }, { supplierId: 'satelink-rpc:polygon', chain: 'polygon' }, {});
  assert.equal(allowed.status, 200);
});

test('integration: RPC workload runs through the frozen kernel to CLOSED', async () => {
  class NoopSettle extends SettlementAdapter {
    capabilities() { return { modes: ['POST'] }; }
    async settleIn() { return { ref: 'in' }; }
    async settleOut(a, u, p, k) { return { ref: `out_${k}` }; }
    async verify() { return { status: 'settled' }; }
  }
  const registry = new Registry(); registry.register(adapter());
  const kernel = new RoutingKernel({
    registry, settlement: new NoopSettle(), journal: new Journal(), idempotency: new IdempotencyStore(), clock: () => 1,
    decisionEngine: new DecisionEngine({ clock: () => 1 }), policy: Policies.cheapest,
    feeEngine: new FeeEngine(), feePolicy: { type: 'bps', bps: 250 }, feeCurrency: 'USDC',
  });
  const tx = await kernel.execute({ workload: 'rpc', query: { chain: 'polygon' }, payload: { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 } }, { txId: deriveTxId('rpc-int-1') });
  assert.equal(tx.state, TxState.CLOSED);
  assert.equal(tx.result.body.result, '0x56775ef');
  assert.equal(tx.supplier.supplierId, 'satelink-rpc:polygon'); // self-supply routed to the requested chain
});
