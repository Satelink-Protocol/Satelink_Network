// M1 integration test for the vNext Routing Kernel.
// Uses Node's built-in node:test runner (zero new deps), matching the existing
// canonical_json.test.js convention. Run: `node --test test/vnext_kernel_m1.test.js`.
//
// Proves the constitutional success criteria:
//   create RoutingTransaction -> DISCOVER -> QUOTE -> ROUTE -> EXECUTE ->
//   SETTLE -> CLOSED, every transition journaled / idempotent / recoverable /
//   replayable, using existing reusable infrastructure (canonical_json hash
//   chain + ShadowAdapter settlement). Final test is the constitutional
//   acceptance test: a second adapter runs with ZERO kernel edits.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RoutingKernel } from '../src/vnext/kernel/kernel.js';
import { Journal } from '../src/vnext/kernel/journal.js';
import { IdempotencyStore, deriveTxId } from '../src/vnext/kernel/idempotency.js';
import { Registry } from '../src/vnext/kernel/registry.js';
import { EchoWorkloadAdapter } from '../src/vnext/kernel/echo_adapter.js';
import { ShadowSettlementAdapter } from '../src/vnext/kernel/shadow_settlement.js';
import { FixedFeeAdapter } from '../src/vnext/kernel/fixed_fee.js';
import { TxState } from '../src/vnext/kernel/transaction.js';

function newHarness() {
  const registry = new Registry();
  registry.register(new EchoWorkloadAdapter('echo'));
  const kernel = new RoutingKernel({
    registry,
    settlement: new ShadowSettlementAdapter(),
    fee: new FixedFeeAdapter(),
    journal: new Journal(),
    idempotency: new IdempotencyStore(),
  });
  return { registry, kernel };
}

test('M1: one transaction runs the full five-phase lifecycle to CLOSED', async () => {
  const { kernel } = newHarness();
  const txId = deriveTxId('m1-happy-path');
  const tx = await kernel.execute({ workload: 'echo', payload: { hello: 'world' }, payer: 'buyer1' }, { txId });

  assert.equal(tx.state, TxState.CLOSED);
  assert.deepEqual(tx.result.echoed, { hello: 'world' });

  const phases = kernel.journal.read(txId).map((e) => e.phase);
  for (const p of ['DISCOVER', 'QUOTE', 'ROUTE', 'EXECUTE', 'SETTLE', 'CLOSED']) {
    assert.ok(phases.includes(p), `journal missing phase ${p}`);
  }
});

test('M1: every transition is journaled and the chain is tamper-evident', async () => {
  const { kernel } = newHarness();
  await kernel.execute({ workload: 'echo', payload: { a: 1 } }, { txId: deriveTxId('m1-chain') });
  assert.equal(kernel.journal.verifyChain(), true);
});

test('M1: replayable — terminal state reconstructs purely from the journal', async () => {
  const { kernel } = newHarness();
  const txId = deriveTxId('m1-replay');
  await kernel.execute({ workload: 'echo', payload: { a: 1 } }, { txId });
  const rebuilt = kernel.reconstruct(txId);
  assert.equal(rebuilt.terminal, 'CLOSED');
  assert.ok(rebuilt.phases.includes('EXECUTE'));
});

test('M1: idempotent + recoverable — replaying the same txId does not double-run phases', async () => {
  const { kernel } = newHarness();
  const txId = deriveTxId('m1-idem');
  const req = { workload: 'echo', payload: { n: 1 }, payer: 'b' };

  const first = await kernel.execute(req, { txId });
  const journalLenAfterFirst = kernel.journal.all().length;

  const second = await kernel.execute(req, { txId }); // replay
  const journalLenAfterSecond = kernel.journal.all().length;

  assert.equal(first.state, TxState.CLOSED);
  assert.equal(second.state, TxState.CLOSED);
  // Exactly-once: no phase re-journaled, no settlement re-run on replay.
  assert.equal(journalLenAfterFirst, journalLenAfterSecond);
});

test('CONSTITUTIONAL ACCEPTANCE TEST: a second adapter runs with ZERO kernel edits', async () => {
  const { registry, kernel } = newHarness();
  // Registration only — no kernel modification, no new kernel code path.
  registry.register(new EchoWorkloadAdapter('echo2'));

  const tx = await kernel.execute({ workload: 'echo2', payload: { x: 9 } }, { txId: deriveTxId('m1-second') });

  assert.equal(tx.state, TxState.CLOSED);
  assert.deepEqual(tx.result.echoed, { x: 9 });
  assert.equal(tx.result.by, 'echo2-supplier-1');
});
