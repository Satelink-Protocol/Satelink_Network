// Wiring proof — the reliability layer composed into the kernel path via
// DurableKernel.boot(): durable journal + idempotency + supplier registry +
// recovery + M3 selection + M4 supply + M5 fee, all through one entry point.
// Runs DB-free (memory durable store) so it always executes; a PG variant of
// the crash path already lives in vnext_reliability_m6_pg.test.js.
// Run: `node --test test/vnext_durable_kernel_m6.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryDurableStore, createMemoryBacking } from '../src/vnext/reliability/memory_durable_store.js';
import { DurableKernel } from '../src/vnext/reliability/durable_kernel.js';

import { Registry } from '../src/vnext/kernel/registry.js';
import { WorkloadAdapter, SettlementAdapter, SettlementMode } from '../src/vnext/kernel/interfaces.js';
import { DecisionEngine } from '../src/vnext/routing/decision_engine.js';
import { Policies } from '../src/vnext/routing/policies.js';
import { FeeEngine } from '../src/vnext/fees/fee_engine.js';
import { HealthMonitor } from '../src/vnext/registry/health_monitor.js';
import { TxState } from '../src/vnext/kernel/transaction.js';

class PricedAdapter extends WorkloadAdapter {
  constructor() { super(); this.execs = 0; this.hang = false; }
  capabilities() { return { key: 'priced', settlementMode: SettlementMode.POST, executionSafety: 'IDEMPOTENT' }; }
  async discover() { return []; } // supply comes from the durable registry
  async quote(_r, s) { return { cost: s.price, unit: 'uUSDC', supplierId: s.supplierId }; }
  async execute(_r, s) { if (this.hang) await new Promise(() => {}); this.execs += 1; return { ok: true, by: s.supplierId }; }
}
class Settlement extends SettlementAdapter {
  constructor() { super(); this.outs = 0; }
  capabilities() { return { modes: ['POST'] }; }
  async settleIn() { return { ref: 'in' }; }
  async settleOut(a, u, p, k) { this.outs += 1; return { ref: `out_${k}` }; }
  async verify() { return { status: 'settled' }; }
}

function bootOpts(store, adapter, settlement, clock) {
  const registry = new Registry(); registry.register(adapter);
  return {
    store, registry, settlement, clock,
    useDurableSuppliers: true,
    makeHealthMonitor: (reg) => new HealthMonitor({ registry: reg, clock, heartbeatTimeoutMs: 100 }),
    decisionEngine: new DecisionEngine({ clock }), policy: Policies.cheapest,
    feeEngine: new FeeEngine(), feePolicy: { type: 'bps', bps: 250 }, feeCurrency: 'uUSDC',
  };
}

test('durable path: full M3+M4+M5 stack runs through DurableKernel.boot()', async () => {
  const backing = createMemoryBacking();
  const clock = () => 1;

  // Seed durable supply first (persisted to the store).
  const seedDK = await DurableKernel.boot(bootOpts(new MemoryDurableStore(backing), new PricedAdapter(), new Settlement(), clock));
  const s = (id, price) => ({ supplierId: id, adapterId: 'priced', supportedWorkloads: ['priced'], supportedSettlementModes: ['POST'], supportedPaymentRails: ['x402'], basePrice: price, latency: 10, reputation: 50, currency: 'uUSDC' });
  await seedDK.supplierRegistry.register(s('A', 100));
  await seedDK.supplierRegistry.register(s('B', 40));  // cheapest
  await seedDK.supplierRegistry.register(s('C', 200));

  // Rebuild a durable kernel from the SAME backing (suppliers rehydrate).
  const settlement = new Settlement();
  const dk = await DurableKernel.boot(bootOpts(new MemoryDurableStore(backing), new PricedAdapter(), settlement, clock));
  assert.equal(dk.supplierRegistry.list().length, 3, 'suppliers did not rehydrate on boot');

  const tx = await dk.submit({ workload: 'priced', payer: '0xB' }, { txId: 'tx_durable_1' });
  assert.equal(tx.state, TxState.CLOSED);
  assert.equal(tx.supplier.supplierId, 'B');          // M3 cheapest through durable kernel
  assert.equal(tx.feeInstruction.feeAmount, '1');     // M5: floor(40 * 250 / 10000) = 1
  assert.equal(settlement.outs, 1);

  // Journal is durable + hash-verified, and includes the SUBMIT marker.
  assert.equal(dk.journal.verifyChain(), true);
  const phases = dk.journal.read('tx_durable_1').map((e) => e.phase);
  for (const p of ['SUBMIT', 'DISCOVER', 'QUOTE', 'ROUTE', 'EXECUTE', 'FEE', 'SETTLE', 'CLOSED']) assert.ok(phases.includes(p), `missing ${p}`);
});

test('durable path: boot() auto-recovers an in-flight transaction after a crash', async () => {
  const backing = createMemoryBacking();
  const clock = () => 1;

  // Seed supply.
  const seed = await DurableKernel.boot(bootOpts(new MemoryDurableStore(backing), new PricedAdapter(), new Settlement(), clock));
  await seed.supplierRegistry.register({ supplierId: 'A', adapterId: 'priced', supportedWorkloads: ['priced'], supportedSettlementModes: ['POST'], supportedPaymentRails: ['x402'], basePrice: 100, latency: 10, reputation: 50, currency: 'uUSDC' });

  // Process 1: adapter hangs in EXECUTE. Submit and "crash" (abandon) mid-flight.
  const hangAdapter = new PricedAdapter(); hangAdapter.hang = true;
  const settlement1 = new Settlement();
  const dk1 = await DurableKernel.boot(bootOpts(new MemoryDurableStore(backing), hangAdapter, settlement1, clock));
  const inflight = dk1.submit({ workload: 'priced', payer: '0xB' }, { txId: 'tx_durable_crash' });
  const killed = await Promise.race([inflight.then(() => 'done'), new Promise((r) => setTimeout(() => r('killed'), 40))]);
  assert.equal(killed, 'killed');
  assert.equal(settlement1.outs, 0);

  // Process 2: boot from the SAME backing with a working adapter. boot() runs a
  // recovery pass, which finishes the in-flight transaction automatically.
  const settlement2 = new Settlement();
  const dk2 = await DurableKernel.boot(bootOpts(new MemoryDurableStore(backing), new PricedAdapter(), settlement2, clock));
  assert.ok(dk2.lastRecovery.resumed.some((r) => r.txId === 'tx_durable_crash'), 'boot did not auto-recover the in-flight tx');
  const phases = dk2.journal.read('tx_durable_crash').map((e) => e.phase);
  assert.ok(phases.includes('CLOSED'), `expected CLOSED after boot-recovery, got ${phases.join(',')}`);
  assert.equal(settlement2.outs, 1, 'settlement not exactly-once across crash+boot-recovery');
});

test('DurableKernel.startRecoveryTimer(): periodic sweeps recover post-boot crashes', async () => {
  const backing = createMemoryBacking();
  const clock = () => 1;
  const seed = await DurableKernel.boot(bootOpts(new MemoryDurableStore(backing), new PricedAdapter(), new Settlement(), clock));
  await seed.supplierRegistry.register({ supplierId: 'A', adapterId: 'priced', supportedWorkloads: ['priced'], supportedSettlementModes: ['POST'], supportedPaymentRails: ['x402'], basePrice: 100, latency: 10, reputation: 50, currency: 'uUSDC' });

  const dk = await DurableKernel.boot(bootOpts(new MemoryDurableStore(backing), new PricedAdapter(), new Settlement(), clock));
  dk.startRecoveryTimer({ intervalMs: 5 });
  // A transaction is submitted but its process "died" mid-flight (SUBMIT only,
  // no terminal) — write the SUBMIT marker directly to simulate that.
  await dk.journal.append('tx_timer', 'SUBMIT', { request: { workload: 'priced', payer: '0xB' } }, 1);

  // Wait for a timer sweep to pick it up and drive it to CLOSED.
  const deadline = Date.now() + 500;
  let phases = [];
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
    phases = dk.journal.read('tx_timer').map((e) => e.phase);
    if (phases.includes('CLOSED')) break;
  }
  await dk.stopRecoveryTimer();
  assert.ok(phases.includes('CLOSED'), `timer recovery did not close the tx, phases=${phases.join(',')}`);
});
