// Integration — M3 DecisionEngine + M5 FeeEngine wired into the kernel, fed by
// the M4 SupplierRegistry. Proves selection rules and revenue flow end-to-end
// through the real kernel, journaled and replayable, with no legacy-path change.
// Run: `node --test test/vnext_wired_m3_m5.test.js`.

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
import { TxState } from '../src/vnext/kernel/transaction.js';

// A priced multi-supplier workload adapter (POST). Discovery comes from the M4
// registry; quote returns each supplier's integer cost.
class PricedAdapter extends WorkloadAdapter {
  constructor(supplierRegistry) { super(); this.reg = supplierRegistry; }
  capabilities() { return { key: 'priced', resourceTypes: ['priced'], settlementMode: SettlementMode.POST, executionSafety: 'IDEMPOTENT' }; }
  async discover() { return this.reg.findCandidates({ workload: 'priced' }); }
  async quote(_req, supplier) { return { cost: supplier.price, unit: 'uUSDC', supplierId: supplier.supplierId }; }
  async execute(_req, supplier) { return { ok: true, servedBy: supplier.supplierId }; }
}

class NoopSettlement extends SettlementAdapter {
  capabilities() { return { modes: ['POST'], units: ['uUSDC'], finality: 'INSTANT' }; }
  async settleIn() { return { ref: 'in' }; }
  async settleOut(amount, unit, payee, idemKey) { return { ref: `out_${idemKey}`, payee }; }
  async verify() { return { status: 'settled' }; }
}

function wire(policy) {
  const journal = new Journal();
  const supplierRegistry = new SupplierRegistry({ journal, clock: () => 1 });
  // A cheapest, B fastest, C highest reputation
  const base = (id, price, latency, rep) => ({ supplierId: id, adapterId: 'priced', supportedWorkloads: ['priced'], supportedSettlementModes: ['POST'], supportedPaymentRails: ['x402'], basePrice: price, latency, reputation: rep, currency: 'uUSDC' });
  supplierRegistry.register(base('A', 100, 200, 50));
  supplierRegistry.register(base('B', 300, 20, 60));
  supplierRegistry.register(base('C', 250, 150, 99));

  const registry = new Registry();
  registry.register(new PricedAdapter(supplierRegistry));

  const kernel = new RoutingKernel({
    registry,
    settlement: new NoopSettlement(),
    journal,
    idempotency: new IdempotencyStore(),
    clock: () => 1,
    decisionEngine: new DecisionEngine({ clock: () => 1 }),
    policy,
    feeEngine: new FeeEngine(),
    feePolicy: { type: 'bps', bps: 250 }, // 2.5% of the winner's cost
    feeCurrency: 'uUSDC',
  });
  return { kernel, journal };
}

test('wired: cheapest policy routes to A and charges 2.5% of its cost', async () => {
  const { kernel, journal } = wire(Policies.cheapest);
  const tx = await kernel.execute({ workload: 'priced', payer: '0xBuyer' }, { txId: deriveTxId('w1') });

  assert.equal(tx.state, TxState.CLOSED);
  assert.equal(tx.supplier.supplierId, 'A');         // M3 selection through the kernel
  assert.equal(tx.decision.chosen.supplierId, 'A');
  assert.equal(tx.feeInstruction.feeType, 'bps');    // M5 fee through the kernel
  assert.equal(tx.feeInstruction.feeAmount, '2');    // floor(100 * 250 / 10000) = 2
  assert.equal(tx.feeInstruction.currency, 'uUSDC');

  const phases = journal.read(tx.id).map((e) => e.phase);
  for (const p of ['DISCOVER', 'QUOTE', 'ROUTE', 'EXECUTE', 'FEE', 'SETTLE', 'CLOSED']) assert.ok(phases.includes(p), `missing ${p}`);
  assert.equal(journal.verifyChain(), true);
  const feeEntry = journal.read(tx.id).find((e) => e.phase === 'FEE');
  assert.equal(feeEntry.payload.out.feeAmount, '2'); // fee journaled + replayable in the tx timeline
});

test('wired: highestReputation policy routes to C (rules only in DecisionEngine)', async () => {
  const { kernel } = wire(Policies.highestReputation);
  const tx = await kernel.execute({ workload: 'priced', payer: '0xB' }, { txId: deriveTxId('w2') });
  assert.equal(tx.supplier.supplierId, 'C');
  assert.equal(tx.feeInstruction.feeAmount, '6'); // floor(250 * 250 / 10000) = 6
});

test('wired: deterministic + idempotent replay (no double fee, one FEE entry)', async () => {
  const { kernel, journal } = wire(Policies.cheapest);
  const txId = deriveTxId('w3');
  const req = { workload: 'priced', payer: '0xB' };
  const a = await kernel.execute(req, { txId });
  const feeEntries1 = journal.all().filter((e) => e.phase === 'FEE').length;
  const b = await kernel.execute(req, { txId }); // replay
  const feeEntries2 = journal.all().filter((e) => e.phase === 'FEE').length;

  assert.equal(a.feeInstruction.auditHash, b.feeInstruction.auditHash);
  assert.equal(feeEntries1, 1);
  assert.equal(feeEntries2, 1); // no second fee
});
