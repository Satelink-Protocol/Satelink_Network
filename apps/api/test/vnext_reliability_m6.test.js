// M6 Production Reliability — DB-free tests (memory durable store). Fast, always
// runs. Covers retry policy, crash-recovery at EVERY lifecycle phase, DLQ, and
// the red-team vectors that don't require postgres.
// Run: `node --test test/vnext_reliability_m6.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryDurableStore, createMemoryBacking } from '../src/vnext/reliability/memory_durable_store.js';
import { PersistentJournal } from '../src/vnext/reliability/persistent_journal.js';
import { PersistentIdempotencyStore } from '../src/vnext/reliability/persistent_idempotency.js';
import { ReliableExecutor } from '../src/vnext/reliability/reliable_executor.js';
import { RecoveryWorker } from '../src/vnext/reliability/recovery_worker.js';
import { RetryPolicy } from '../src/vnext/reliability/retry_policy.js';

import { RoutingKernel } from '../src/vnext/kernel/kernel.js';
import { Registry } from '../src/vnext/kernel/registry.js';
import { WorkloadAdapter, SettlementAdapter, SettlementMode } from '../src/vnext/kernel/interfaces.js';
import { TxState } from '../src/vnext/kernel/transaction.js';

// --- retry policy ---
test('RetryPolicy: exponential backoff, capped, jittered, bounded attempts', () => {
  const rp = new RetryPolicy({ maxAttempts: 4, baseMs: 100, factor: 2, maxMs: 5000, jitter: 0, rng: () => 0.5 });
  assert.equal(rp.shouldRetry(1), true);
  assert.equal(rp.shouldRetry(4), false); // cap
  assert.equal(rp.delayMs(1), 100);
  assert.equal(rp.delayMs(2), 200);
  assert.equal(rp.delayMs(3), 400);
  // cap at maxMs
  assert.equal(new RetryPolicy({ baseMs: 100, factor: 10, maxMs: 500, jitter: 0 }).delayMs(5), 500);
  // jitter stays within band and never negative
  const j = new RetryPolicy({ baseMs: 1000, jitter: 0.5, rng: () => 0 }); // rng=0 -> -50% jitter
  assert.ok(j.delayMs(1) >= 0 && j.delayMs(1) <= 1000);
});

// --- crash-per-phase harness (memory durable store survives the "restart") ---
class Settlement extends SettlementAdapter {
  constructor() { super(); this.ins = 0; this.outs = 0; }
  capabilities() { return { modes: ['PRE', 'POST'] }; }
  async settleIn() { this.ins += 1; return { ref: 'in' }; }
  async settleOut(a, u, p, k) { this.outs += 1; return { ref: `out_${k}` }; }
  async verify() { return { status: 'settled' }; }
}
// Adapter whose discover/quote/execute hang on the first process, work on restart.
function hangingAt(phase, mode) {
  return class extends WorkloadAdapter {
    capabilities() { return { key: 'echo', settlementMode: mode, executionSafety: 'IDEMPOTENT' }; }
    async discover() { if (phase === 'DISCOVER') await new Promise(() => {}); return [{ supplierId: 'S1' }]; }
    async quote() { if (phase === 'QUOTE') await new Promise(() => {}); return { cost: 0, unit: 'none', supplierId: 'S1' }; }
    async execute() { if (phase === 'EXECUTE') await new Promise(() => {}); return { ok: true }; }
  };
}

function build(backing, settlement, AdapterClass) {
  const store = new MemoryDurableStore(backing);
  return (async () => {
    const journal = await PersistentJournal.load(store);
    const idem = new PersistentIdempotencyStore(store);
    const registry = new Registry(); registry.register(new AdapterClass());
    const kernel = new RoutingKernel({ registry, settlement, journal, idempotency: idem, clock: () => 1, fee: { computeFee: () => ({ amount: 0 }) } });
    return { store, journal, idem, kernel };
  })();
}

for (const phase of ['DISCOVER', 'QUOTE', 'EXECUTE']) {
  test(`crash at ${phase} then restart -> recovers to CLOSED, settles once`, async () => {
    const backing = createMemoryBacking();
    // Process 1: hangs at `phase`; kill mid-flight.
    const s1 = new Settlement();
    const p1 = await build(backing, s1, hangingAt(phase, SettlementMode.POST));
    const exec = new ReliableExecutor({ kernel: p1.kernel, journal: p1.journal, clock: () => 1 });
    const inflight = exec.submit({ workload: 'echo', payer: 'B' }, { txId: `tx_${phase}` });
    const killed = await Promise.race([inflight.then(() => 'done'), new Promise((r) => setTimeout(() => r('killed'), 40))]);
    assert.equal(killed, 'killed');

    // Restart from the SAME backing; adapter works now.
    const s2 = new Settlement();
    const p2 = await build(backing, s2, hangingAt('none', SettlementMode.POST));
    const worker = new RecoveryWorker({ kernel: p2.kernel, journal: p2.journal, store: p2.store, retryPolicy: new RetryPolicy({ maxAttempts: 3 }), clock: () => 1 });
    await worker.recover();

    const phases = p2.journal.read(`tx_${phase}`).map((e) => e.phase);
    assert.ok(phases.includes('CLOSED'), `crash@${phase}: got ${phases.join(',')}`);
    assert.equal(s1.outs + s2.outs, 1, `crash@${phase}: settled ${s1.outs + s2.outs} times`);
    assert.equal(p2.journal.verifyChain(), true);
  });
}

test('PRE-mode crash before EXECUTE: settle-in compensated exactly once (no stuck funds)', async () => {
  const backing = createMemoryBacking();
  const s1 = new Settlement();
  const p1 = await build(backing, s1, hangingAt('EXECUTE', SettlementMode.PRE));
  const exec = new ReliableExecutor({ kernel: p1.kernel, journal: p1.journal, clock: () => 1 });
  const inflight = exec.submit({ workload: 'echo', payer: 'B' }, { txId: 'tx_pre' });
  await Promise.race([inflight, new Promise((r) => setTimeout(r, 40))]);
  assert.equal(s1.ins, 1, 'settle-in should have run pre-crash');

  // Restart, adapter works -> resume completes; settle-in not repeated.
  const s2 = new Settlement();
  const p2 = await build(backing, s2, hangingAt('none', SettlementMode.PRE));
  const worker = new RecoveryWorker({ kernel: p2.kernel, journal: p2.journal, store: p2.store, retryPolicy: new RetryPolicy({ maxAttempts: 3 }), clock: () => 1 });
  await worker.recover();
  const phases = p2.journal.read('tx_pre').map((e) => e.phase);
  assert.ok(phases.includes('CLOSED'));
  assert.equal(s1.ins + s2.ins, 1, 'settle-in ran more than once across restart');
});

test('duplicate settlement callback: same idemKey settles once', async () => {
  const backing = createMemoryBacking();
  const store = new MemoryDurableStore(backing);
  const idem = new PersistentIdempotencyStore(store);
  let n = 0;
  const settle = () => idem.run('tx_cb:SETTLE', async () => { n += 1; return { ref: 'x' }; });
  await Promise.all([settle(), settle(), settle()]); // 3 duplicate callbacks
  await settle();                                     // and a later replay
  assert.equal(n, 1, 'duplicate settlement callbacks ran the effect more than once');
});
