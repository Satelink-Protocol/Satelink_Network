// Recovery Scheduler — timer-driven recovery sweeps. DB-free (memory store).
// Proves: periodic sweeps pick up transactions that become stuck AFTER boot,
// sweeps never overlap, a failing sweep does not stop the loop, stop() halts it,
// and the timer does not keep the process alive.
// Run: `node --test test/vnext_recovery_scheduler_m6.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RecoveryScheduler } from '../src/vnext/reliability/recovery_scheduler.js';
import { MemoryDurableStore, createMemoryBacking } from '../src/vnext/reliability/memory_durable_store.js';
import { PersistentJournal } from '../src/vnext/reliability/persistent_journal.js';
import { RecoveryWorker } from '../src/vnext/reliability/recovery_worker.js';
import { RetryPolicy } from '../src/vnext/reliability/retry_policy.js';

test('scheduler runs recovery repeatedly and picks up newly-stuck transactions', async () => {
  const backing = createMemoryBacking();
  const store = new MemoryDurableStore(backing);
  const journal = await PersistentJournal.load(store);
  const stuckKernel = { execute: async () => { throw new Error('stuck'); } };
  const worker = new RecoveryWorker({ kernel: stuckKernel, journal, store, retryPolicy: new RetryPolicy({ maxAttempts: 1 }), clock: () => 1 });

  const sched = new RecoveryScheduler({ worker, intervalMs: 5 });
  // Nothing stuck yet.
  await sched.runOnce();
  assert.equal((await store.dlqAll()).length, 0);

  // A transaction becomes stuck AFTER the scheduler started.
  await journal.append('tx_late', 'SUBMIT', { request: { workload: 'x' } }, 1);
  await sched.runOnce();
  assert.ok(await store.dlqGet('tx_late'), 'periodic sweep did not pick up the newly-stuck tx');
  assert.equal(sched.sweeps, 2);
});

test('sweeps never overlap (a slow sweep blocks the next)', async () => {
  let active = 0; let maxActive = 0; let calls = 0;
  const slowRecover = async () => {
    calls += 1; active += 1; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 15));
    active -= 1; return { resumed: [], deadLettered: [] };
  };
  const sched = new RecoveryScheduler({ recover: slowRecover, intervalMs: 1 });
  // Fire three runOnce() concurrently; the guard must serialize them to one.
  await Promise.all([sched.runOnce(), sched.runOnce(), sched.runOnce()]);
  assert.equal(maxActive, 1, 'recovery sweeps overlapped');
  assert.equal(calls, 1, 'concurrent runOnce did not dedupe to a single sweep');
});

test('a failing sweep does not stop the loop; error is captured', async () => {
  let n = 0;
  const recover = async () => { n += 1; if (n === 1) throw new Error('boom'); return { resumed: [], deadLettered: [] }; };
  const errors = [];
  const sched = new RecoveryScheduler({ recover, intervalMs: 1, onError: (e) => errors.push(e) });
  const r1 = await sched.runOnce(); // throws internally -> null, captured
  assert.equal(r1, null);
  assert.equal(errors.length, 1);
  const r2 = await sched.runOnce(); // loop still works
  assert.deepEqual(r2, { resumed: [], deadLettered: [] });
  assert.equal(sched.lastError, null);
});

test('start()/stop() with real timers; timer is unref-safe', async () => {
  let calls = 0;
  const sched = new RecoveryScheduler({ recover: async () => { calls += 1; return { resumed: [], deadLettered: [] }; }, intervalMs: 5 });
  sched.start();
  sched.start(); // idempotent
  await new Promise((r) => setTimeout(r, 30)); // ~5 sweeps at 5ms
  sched.stop();
  await sched.drain();
  const after = calls;
  assert.ok(after >= 2, `expected multiple sweeps, got ${after}`);
  // No further sweeps after stop.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, after, 'sweeps continued after stop()');
});
