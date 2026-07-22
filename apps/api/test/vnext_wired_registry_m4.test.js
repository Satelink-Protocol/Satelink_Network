// Integration — M4 SupplierRegistry + HealthMonitor wired into the kernel.
// DISCOVER pulls candidates from the registry; the HealthMonitor auto-excludes
// stale suppliers, changing kernel selection. M3 selects, M5 charges — all
// through the real kernel. Run: `node --test test/vnext_wired_registry_m4.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RoutingKernel } from '../src/vnext/kernel/kernel.js';
import { Journal } from '../src/vnext/kernel/journal.js';
import { IdempotencyStore, deriveTxId } from '../src/vnext/kernel/idempotency.js';
import { Registry } from '../src/vnext/kernel/registry.js';
import { WorkloadAdapter, SettlementAdapter, SettlementMode } from '../src/vnext/kernel/interfaces.js';
import { DecisionEngine } from '../src/vnext/routing/decision_engine.js';
import { Policies } from '../src/vnext/routing/policies.js';
import { FeeEngine } from '../src/vnext/fees/fee_engine.js';
import { SupplierRegistry } from '../src/vnext/registry/supplier_registry.js';
import { HealthMonitor } from '../src/vnext/registry/health_monitor.js';
import { TxState } from '../src/vnext/kernel/transaction.js';

// Adapter that quotes/executes against registry candidate records (no discover;
// the kernel sources candidates from the registry).
class PricedAdapter extends WorkloadAdapter {
  capabilities() { return { key: 'priced', settlementMode: SettlementMode.POST, executionSafety: 'IDEMPOTENT' }; }
  async discover() { return []; } // unused when supplierRegistry is wired
  async quote(_req, s) { return { cost: s.price, unit: s.currency || 'uUSDC', supplierId: s.supplierId }; }
  async execute(_req, s) { return { ok: true, servedBy: s.supplierId }; }
}
class NoopSettlement extends SettlementAdapter {
  capabilities() { return { modes: ['POST'] }; }
  async settleIn() { return { ref: 'in' }; }
  async settleOut(a, u, p, k) { return { ref: `out_${k}`, payee: p }; }
  async verify() { return { status: 'settled' }; }
}

function wire() {
  const clockState = { t: 1000 };
  const clock = () => clockState.t;
  const journal = new Journal();
  const supplierRegistry = new SupplierRegistry({ journal, clock });
  const s = (id, price) => ({ supplierId: id, adapterId: 'priced', supportedWorkloads: ['priced'], supportedSettlementModes: ['POST'], supportedPaymentRails: ['x402'], basePrice: price, latency: 50, reputation: 50, currency: 'uUSDC' });
  supplierRegistry.register(s('A', 100));
  supplierRegistry.register(s('B', 50));  // cheapest
  supplierRegistry.register(s('C', 200));

  const healthMonitor = new HealthMonitor({ registry: supplierRegistry, clock, heartbeatTimeoutMs: 100 });
  const registry = new Registry();
  registry.register(new PricedAdapter());

  const kernel = new RoutingKernel({
    registry, settlement: new NoopSettlement(), journal, idempotency: new IdempotencyStore(), clock,
    supplierRegistry, healthMonitor,
    decisionEngine: new DecisionEngine({ clock }), policy: Policies.cheapest,
    feeEngine: new FeeEngine(), feePolicy: { type: 'bps', bps: 250 }, feeCurrency: 'uUSDC',
  });
  return { kernel, supplierRegistry, clockState, journal };
}

test('kernel DISCOVER sources candidates from the registry; cheapest healthy wins', async () => {
  const { kernel } = wire();
  const tx = await kernel.execute({ workload: 'priced', payer: '0xB' }, { txId: deriveTxId('r1') });
  assert.equal(tx.state, TxState.CLOSED);
  assert.equal(tx.supplier.supplierId, 'B'); // B is cheapest and healthy
  assert.equal(tx.feeInstruction.feeAmount, '1'); // floor(50 * 250 / 10000) = 1
});

test('HealthMonitor auto-excludes a stale supplier, changing kernel selection', async () => {
  const { kernel, supplierRegistry, clockState } = wire();
  // Keep A and C fresh; let B (cheapest) go stale.
  clockState.t = 1180;
  supplierRegistry.heartbeat('A');
  supplierRegistry.heartbeat('C');
  clockState.t = 1200; // B's last heartbeat (1000) is now 200ms old > 100ms timeout

  const tx = await kernel.execute({ workload: 'priced', payer: '0xB' }, { txId: deriveTxId('r2') });
  assert.equal(tx.state, TxState.CLOSED);
  assert.equal(supplierRegistry.get('B').status, 'offline'); // health monitor ran in DISCOVER
  assert.equal(tx.supplier.supplierId, 'A'); // B excluded -> next cheapest healthy is A
  assert.equal(tx.feeInstruction.feeAmount, '2'); // floor(100 * 250 / 10000) = 2
});
