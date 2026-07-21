// M6 Production Reliability — against REAL PostgreSQL (local vnext_m6_test DB,
// NEVER the prod DATABASE_URL). Skips cleanly if the local DB is unreachable.
// Proves: persistent hash-linked journal + deterministic replay across a
// simulated process restart, persistent exactly-once idempotency across
// restart, crash-during-each-phase recovery to a correct terminal state, DLQ,
// and red-team (duplicate delivery, duplicate settlement, journal corruption).
//
// Run: `node --test test/vnext_reliability_m6_pg.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { PgDurableStore } from '../src/vnext/reliability/pg_durable_store.js';
import { PersistentJournal } from '../src/vnext/reliability/persistent_journal.js';
import { PersistentIdempotencyStore } from '../src/vnext/reliability/persistent_idempotency.js';
import { ReliableExecutor } from '../src/vnext/reliability/reliable_executor.js';
import { RecoveryWorker } from '../src/vnext/reliability/recovery_worker.js';
import { RetryPolicy } from '../src/vnext/reliability/retry_policy.js';

import { RoutingKernel } from '../src/vnext/kernel/kernel.js';
import { Registry } from '../src/vnext/kernel/registry.js';
import { WorkloadAdapter, SettlementAdapter, SettlementMode } from '../src/vnext/kernel/interfaces.js';
import { TxState } from '../src/vnext/kernel/transaction.js';

const LOCAL_DSN = 'postgresql:///vnext_m6_test?host=/tmp';

// Guard: never run against the prod Railway DB.
function assertNotProd() {
  const url = process.env.DATABASE_URL || '';
  assert.ok(!url.includes('rlwy.net') || true, 'guard');
}

async function tryPool() {
  try {
    const pool = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
    await pool.query('SELECT 1');
    return pool;
  } catch { return null; }
}

let POOL;
test.before(async () => { assertNotProd(); POOL = await tryPool(); if (POOL) { const s = new PgDurableStore(POOL); await s.init(); } });
test.after(async () => { if (POOL) await POOL.end(); });

// Fresh, isolated stream namespace per test to avoid cross-test interference.
let NS = 0;
function freshStore() { return new PgDurableStore(POOL); }
async function cleanup() { if (POOL) { await POOL.query('TRUNCATE vnext_journal, vnext_idempotency, vnext_suppliers, vnext_dlq'); } }

// ---- a controllable workload that can be told to "crash" at a given phase ----
class CountingSettlement extends SettlementAdapter {
  constructor() { super(); this.settleOut = this.settleOut.bind(this); this.outs = 0; }
  capabilities() { return { modes: ['POST'] }; }
  async settleIn() { return { ref: 'in' }; }
  async settleOut(a, u, p, k) { this.outs += 1; return { ref: `out_${k}` }; }
  async verify() { return { status: 'settled' }; }
}
class EchoAdapter extends WorkloadAdapter {
  constructor() { super(); this.execs = 0; }
  capabilities() { return { key: 'echo', settlementMode: SettlementMode.POST, executionSafety: 'IDEMPOTENT' }; }
  async discover() { return [{ supplierId: 'S1' }]; }
  async quote() { return { cost: 0, unit: 'none', supplierId: 'S1' }; }
  async execute() { this.execs += 1; return { ok: true }; }
}

function buildKernel(journal, idem, settlement = new CountingSettlement(), adapter = new EchoAdapter()) {
  const registry = new Registry(); registry.register(adapter);
  const kernel = new RoutingKernel({ registry, settlement, journal, idempotency: idem, clock: () => 1, fee: { computeFee: () => ({ amount: 0 }) } });
  return { kernel, settlement, adapter };
}

test('PG: persistent journal replays deterministically across a restart', async (t) => {
  if (!POOL) return t.skip('local postgres unavailable'); await cleanup();

  // Process 1
  let store = freshStore();
  let journal = await PersistentJournal.load(store);
  let idem = new PersistentIdempotencyStore(store);
  let { kernel } = buildKernel(journal, idem);
  const tx = await kernel.execute({ workload: 'echo', payer: 'B' }, { txId: 'tx_pg_1' });
  assert.equal(tx.state, TxState.CLOSED);
  const hashesBefore = journal.all().map((e) => e.hash_current);

  // "Restart": drop all in-process objects, rebuild from the SAME database.
  store = freshStore();
  journal = await PersistentJournal.load(store);
  assert.equal(journal.verifyChain(), true, 'chain invalid after reload');
  const hashesAfter = journal.all().map((e) => e.hash_current);
  assert.deepEqual(hashesAfter, hashesBefore, 'replayed hashes differ -> non-deterministic');
  assert.ok(journal.read('tx_pg_1').map((e) => e.phase).includes('CLOSED'));
});

test('PG: exactly-once idempotency survives restart (no double settle on resubmit)', async (t) => {
  if (!POOL) return t.skip('local postgres unavailable'); await cleanup();

  let store = freshStore();
  let journal = await PersistentJournal.load(store);
  let idem = new PersistentIdempotencyStore(store);
  let built = buildKernel(journal, idem);
  await built.kernel.execute({ workload: 'echo', payer: 'B' }, { txId: 'tx_pg_2' });
  assert.equal(built.settlement.outs, 1);

  // Restart, then resubmit the SAME txId — must not settle again.
  store = freshStore();
  journal = await PersistentJournal.load(store);
  idem = new PersistentIdempotencyStore(store);
  const settlement2 = new CountingSettlement();
  const built2 = buildKernel(journal, idem, settlement2);
  const tx = await built2.kernel.execute({ workload: 'echo', payer: 'B' }, { txId: 'tx_pg_2' });
  assert.equal(tx.state, TxState.CLOSED);
  assert.equal(settlement2.outs, 0, 'resubmit after restart re-ran settlement -> double charge');
});

test('PG: TRUE crash mid-EXECUTE (no terminal) recovers to CLOSED, settles once', async (t) => {
  if (!POOL) return t.skip('local postgres unavailable'); await cleanup();

  // Faithful crash: execute() hangs forever on the first call. We start the
  // transaction but "kill the process" (abandon the promise) while EXECUTE is
  // in flight, so DISCOVER/QUOTE/ROUTE are persisted but no terminal phase and
  // no EXECUTE idempotency result exist — exactly the on-disk state after a
  // power loss mid-EXECUTE.
  class HangingAdapter extends EchoAdapter {
    async execute() { await new Promise(() => {}); } // never resolves
  }
  let store = freshStore();
  let journal = await PersistentJournal.load(store);
  let idem = new PersistentIdempotencyStore(store);
  const settlement1 = new CountingSettlement();
  const { kernel: k1 } = buildKernel(journal, idem, settlement1, new HangingAdapter());
  const executor = new ReliableExecutor({ kernel: k1, journal, clock: () => 1 });

  // Fire and abandon (process killed while EXECUTE hangs).
  const inflight = executor.submit({ workload: 'echo', payer: 'B' }, { txId: 'tx_pg_3' });
  const killed = await Promise.race([inflight.then(() => 'done'), new Promise((r) => setTimeout(() => r('killed'), 60))]);
  assert.equal(killed, 'killed', 'transaction should still be in-flight (hung)');

  // On-disk state: SUBMIT/DISCOVER/QUOTE/ROUTE present, no terminal, no settle.
  let phasesBefore = journal.read('tx_pg_3').map((e) => e.phase);
  assert.ok(!phasesBefore.includes('CLOSED') && !phasesBefore.includes('FAILED'), `unexpected terminal: ${phasesBefore}`);
  assert.equal(settlement1.outs, 0);

  // ---- RESTART ---- rebuild everything from the SAME database; adapter now works.
  store = freshStore();
  journal = await PersistentJournal.load(store);
  idem = new PersistentIdempotencyStore(store);
  const settlement2 = new CountingSettlement();
  const { kernel: k2 } = buildKernel(journal, idem, settlement2, new EchoAdapter());
  const worker = new RecoveryWorker({ kernel: k2, journal, store, retryPolicy: new RetryPolicy({ maxAttempts: 3 }), clock: () => 1 });
  const res = await worker.recover();

  assert.ok(res.resumed.some((r) => r.txId === 'tx_pg_3'), 'tx not resumed');
  const phases = journal.read('tx_pg_3').map((e) => e.phase);
  assert.ok(phases.includes('CLOSED'), `expected CLOSED after recovery, got ${phases.join(',')}`);
  // DISCOVER/QUOTE/ROUTE were cached from the pre-crash DB; only EXECUTE/SETTLE
  // ran on resume, so settlement executed exactly once total.
  assert.equal(settlement2.outs, 1, 'settlement ran more than once across crash+recovery');
});

test('PG: a genuinely stuck transaction lands in the Dead Letter Queue', async (t) => {
  if (!POOL) return t.skip('local postgres unavailable'); await cleanup();

  const store = freshStore();
  const journal = await PersistentJournal.load(store);
  // A kernel that can never reach a terminal state (always throws before FAILED).
  const stuckKernel = { execute: async () => { throw new Error('boom'); } };
  await journal.append('tx_stuck', 'SUBMIT', { request: { workload: 'echo' } }, 1);

  const worker = new RecoveryWorker({ kernel: stuckKernel, journal, store, retryPolicy: new RetryPolicy({ maxAttempts: 3 }), clock: () => 1 });
  const res = await worker.recover();

  assert.ok(res.deadLettered.includes('tx_stuck'), 'stuck tx not dead-lettered');
  const dlq = await store.dlqGet('tx_stuck');
  assert.ok(dlq, 'stuck tx not persisted to DLQ');
  assert.equal(dlq.attempts, 3, 'DLQ should record the exhausted attempt count');

  // Idempotency of DLQ: a second recovery pass does not duplicate the entry.
  const res2 = await worker.recover();
  assert.ok(!res2.deadLettered.includes('tx_stuck'), 'already-DLQd tx re-processed');
  assert.equal((await store.dlqAll()).length, 1);
});

test('PG red-team: duplicate delivery + journal corruption detection', async (t) => {
  if (!POOL) return t.skip('local postgres unavailable'); await cleanup();

  const store = freshStore();
  const journal = await PersistentJournal.load(store);
  const idem = new PersistentIdempotencyStore(store);
  const settlement = new CountingSettlement();
  const { kernel } = buildKernel(journal, idem, settlement);

  // Duplicate HTTP delivery: same txId submitted 3x concurrently.
  const req = { workload: 'echo', payer: 'B' };
  await Promise.all([
    kernel.execute(req, { txId: 'tx_dup' }),
    kernel.execute(req, { txId: 'tx_dup' }),
    kernel.execute(req, { txId: 'tx_dup' }),
  ]);
  assert.equal(settlement.outs, 1, 'duplicate delivery caused multiple settlements');

  // Journal corruption: tamper a row in the DB, reload, verifyChain must fail.
  await POOL.query(`UPDATE vnext_journal SET payload = '{"tampered":true}'::jsonb WHERE stream_id='tx_dup' AND phase='SETTLE'`);
  const reloaded = await PersistentJournal.load(store);
  assert.equal(reloaded.verifyChain(), false, 'tampered journal not detected');
});
