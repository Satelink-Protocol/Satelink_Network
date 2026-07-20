// Reviewer regression: concurrent execution of the SAME txId must settle once.
// This exercises the idempotency guard under real concurrency (not sequential
// replay), which is where a TOCTOU race in `once()` shows up as a double charge.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RoutingKernel } from '../src/vnext/kernel/kernel.js';
import { Journal } from '../src/vnext/kernel/journal.js';
import { IdempotencyStore, deriveTxId } from '../src/vnext/kernel/idempotency.js';
import { Registry } from '../src/vnext/kernel/registry.js';
import { EchoWorkloadAdapter } from '../src/vnext/kernel/echo_adapter.js';
import { FixedFeeAdapter } from '../src/vnext/kernel/fixed_fee.js';
import { SettlementAdapter } from '../src/vnext/kernel/interfaces.js';

// Settlement adapter that (a) counts settleOut calls and (b) yields on an await
// inside settleOut so a concurrent caller can interleave — the exact condition
// a real network settlement creates.
class CountingSettlement extends SettlementAdapter {
  constructor() { super(); this.settleOutCount = 0; }
  capabilities() { return { modes: ['POST'], units: ['none'], finality: 'INSTANT' }; }
  async settleIn() { return { ref: 'in' }; }
  async settleOut() { await Promise.resolve(); this.settleOutCount += 1; return { ref: `out_${this.settleOutCount}` }; }
  async verify() { return { status: 'settled' }; }
}

test('concurrent execute of same txId settles exactly once (no double charge)', async () => {
  const registry = new Registry();
  registry.register(new EchoWorkloadAdapter('echo'));
  const settlement = new CountingSettlement();
  const kernel = new RoutingKernel({
    registry, settlement, fee: new FixedFeeAdapter(),
    journal: new Journal(), idempotency: new IdempotencyStore(),
  });

  const req = { workload: 'echo', payload: { n: 1 }, payer: 'B' };
  const txId = deriveTxId('concurrent-1');
  await Promise.all([kernel.execute(req, { txId }), kernel.execute(req, { txId })]);

  assert.equal(settlement.settleOutCount, 1, 'settleOut ran more than once — double charge');
  assert.equal(kernel.journal.all().filter((e) => e.phase === 'SETTLE').length, 1, 'SETTLE journaled more than once');
});

test('two distinct requests without an explicit txId do not collide (same clock tick)', async () => {
  const registry = new Registry();
  registry.register(new EchoWorkloadAdapter('echo'));
  const kernel = new RoutingKernel({
    registry, settlement: new CountingSettlement(), fee: new FixedFeeAdapter(),
    journal: new Journal(), idempotency: new IdempotencyStore(), clock: () => 1000, // frozen clock
  });

  const a = await kernel.execute({ workload: 'echo', payload: { id: 'A' } });
  const b = await kernel.execute({ workload: 'echo', payload: { id: 'B' } });

  assert.notEqual(a.id, b.id, 'distinct requests collided to the same txId');
  assert.deepEqual(a.result.echoed, { id: 'A' });
  assert.deepEqual(b.result.echoed, { id: 'B' }, 'B received a stale/cross-transaction result');
});
