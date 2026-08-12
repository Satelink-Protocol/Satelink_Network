/**
 * M7 reconciler + settlement-poller + outbox integration tests.
 *
 * Ephemeral Postgres via testcontainers (migrations 001–011 applied); the chain
 * is a FakeChainReader so nothing touches the network. Mirrors the exit gate:
 * clean cycles report drift 0; ledger↔chain disagreement halts with a critical
 * event; removing it resumes. The production DATABASE_URL is never read.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { resolve } from 'node:path';
import { migrate } from '../../../database/runner.js';
import { runCycle } from './cycle.js';
import { reconcileOnce } from './reconciler/reconcile.js';
import { pollOnce } from './settlement-poller/poll.js';
import { publishOnce, type OutboxEvent } from './outbox-publisher/publish.js';
import { reconciliationBody } from './http-server.js';
import { readReconciliationState, emitEvent } from './state.js';
import { FakeChainReader } from './adapters/fake-reader.js';
import type { TransferObservation } from './ports/chain-reader.js';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../../database/migrations',
);

const TX = '0x7bc61296168bbd5ef3f8e1ca9b86ce845d73f15219f915680dd58d6e6ddc1f63';
const REF = `x402:${TX}`;
const NOW = new Date('2026-08-12T12:00:00.000Z');
const CFG = { minConfirmations: 5, stuckSettlementAgeMs: 15 * 60 * 1000 };
const noopDeliver = async (): Promise<void> => undefined;

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

function confirmed(amountMinor: bigint, confirmations = 20): TransferObservation {
  return { found: true, success: true, confirmations, amountToRecipientMinor: amountMinor };
}

function readerWith(tx: string, obs: TransferObservation): FakeChainReader {
  return new FakeChainReader().set(tx, obs);
}

/** Seed one revenue_event ledger txn with balanced entries (one transaction so
 *  the deferred balance trigger sees debit == credit at COMMIT). */
async function seedRevenueEvent(txHash: string, amountMinor: bigint, currency = 'USDC'): Promise<void> {
  const txnId = `shadow:x402:${txHash}`;
  const refId = `x402:${txHash}`;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO ledger_txns (txn_id, kind, ref_type, ref_id, currency, state, posted_at)
       VALUES ($1,'deposit','revenue_event',$2,$3,'posted', now())`,
      [txnId, refId, currency],
    );
    await c.query(
      `INSERT INTO ledger_entries (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key, posted_at)
       VALUES ($1,'acct_platform_suspense','debit',$2,$5,'posted','revenue_event',$3,$4, now())`,
      [txnId, amountMinor.toString(), refId, `${txnId}:d`, currency],
    );
    await c.query(
      `INSERT INTO ledger_entries (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key, posted_at)
       VALUES ($1,'acct_platform_revenue','credit',$2,$5,'posted','revenue_event',$3,$4, now())`,
      [txnId, amountMinor.toString(), refId, `${txnId}:c`, currency],
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/** Seed the FK chain for a draw and a settlement in `settling`. */
async function seedSettlingDraw(opts: {
  drawId: string;
  createdAt: Date;
  railTxHash: string | null;
  railNetwork: string | null;
}): Promise<void> {
  const suffix = opts.drawId;
  const prn = `prn_${suffix}`;
  const acct = `acct_${suffix}`;
  const fs = `fs_${suffix}`;
  const auth = `auth_${suffix}`;
  await pool.query(`INSERT INTO principals (id, kind, state) VALUES ($1,'human','active')`, [prn]);
  await pool.query(
    `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals, state)
     VALUES ($1,$2,'capacity','debit','USDT',6,'open')`,
    [acct, prn],
  );
  await pool.query(
    `INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state)
     VALUES ($1,$2,'x402','{}'::jsonb,'pull','{}'::jsonb,'active')`,
    [fs, prn],
  );
  await pool.query(
    `INSERT INTO authorizations (id, principal_id, funding_source_id, cap_amount, currency, valid_after, valid_before, signature_envelope, state)
     VALUES ($1,$2,$3,1000000,'USDT',0,99999999999,'{}'::jsonb,'active')`,
    [auth, prn, fs],
  );
  await pool.query(
    `INSERT INTO draws (id, principal_id, account_id, funding_source_id, authorization_id, amount, currency, idempotency_key, state, version, created_at)
     VALUES ($1,$2,$3,$4,$5,500,'USDT',$6,'settling',1,$7)`,
    [opts.drawId, prn, acct, fs, auth, `idem_${suffix}`, opts.createdAt],
  );
  await pool.query(
    `INSERT INTO settlements (draw_id, state, rail_tx_hash, rail_network, confirmations, required_confirmations, attempt_count)
     VALUES ($1,'pending',$2,$3,0,2,0)`,
    [opts.drawId, opts.railTxHash, opts.railNetwork],
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const result = await migrate(container.getConnectionUri(), MIGRATIONS_DIR);
  if (result.errors.length > 0) throw new Error(`migration failed: ${result.errors.join('; ')}`);
  pool = new pg.Pool({ connectionString: container.getConnectionUri() });
}, 120_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

beforeEach(async () => {
  await pool.query('TRUNCATE draws, settlements, ledger_txns, ledger_entries, outbox RESTART IDENTITY CASCADE');
  await pool.query(
    `UPDATE reconciliation_state SET halted=false, drift_minor_units=0, halt_reason=NULL,
       last_run_at=NULL, stuck_settlement_count=0, reconciled_count=0, cycle_duration_ms=0 WHERE id=1`,
  );
});

describe('reconciler — ledger ⟷ chain', () => {
  it('matched revenue_event → drift 0, not halted, over 3 consecutive cycles', async () => {
    await seedRevenueEvent(TX, 100_000n);
    const chain = readerWith(TX, confirmed(100_000n));
    for (let i = 0; i < 3; i++) {
      const out = await runCycle(pool, chain, CFG, noopDeliver, NOW);
      expect(out.snapshot.driftMinorUnits).toBe(0n);
      expect(out.snapshot.halted).toBe(false);
      expect(out.snapshot.reconciledCount).toBe(1);
    }
    const body = await reconciliationBody(pool);
    expect(body.drift_minor_units).toBe('0');
    expect(body.halted).toBe(false);
    expect(body.reconciled_count).toBe(1);
  });

  it('amount mismatch (ledger 100000 ≠ chain 50000) → halt + critical outbox event', async () => {
    await seedRevenueEvent(TX, 100_000n);
    const chain = readerWith(TX, confirmed(50_000n));
    const res = await reconcileOnce(pool, chain, CFG);
    expect(res.driftMinorUnits).toBe(50_000n);
    expect(res.halted).toBe(true);
    expect(res.haltReason).toBe('LEDGER_CHAIN_DRIFT');
    expect(res.rows[0]?.status).toBe('amount_mismatch');
    const ev = await pool.query(
      `SELECT event_id, severity, event_type FROM outbox WHERE severity='critical'`,
    );
    expect(ev.rowCount).toBe(1);
    expect(ev.rows[0]!.event_type).toBe('reconciliation.drift_detected');
  });

  it('missing on-chain tx → halt, drift = full ledger amount, status not_found', async () => {
    await seedRevenueEvent(TX, 100_000n);
    const chain = new FakeChainReader(); // tx not seeded → not found
    const res = await reconcileOnce(pool, chain, CFG);
    expect(res.halted).toBe(true);
    expect(res.driftMinorUnits).toBe(100_000n);
    expect(res.rows[0]?.status).toBe('not_found');
  });

  it('unconfirmed tx (below minConfirmations) → halt, treated as unsettled', async () => {
    await seedRevenueEvent(TX, 100_000n);
    const chain = readerWith(TX, confirmed(100_000n, 1)); // 1 < minConfirmations 5
    const res = await reconcileOnce(pool, chain, CFG);
    expect(res.halted).toBe(true);
    expect(res.rows[0]?.status).toBe('unconfirmed');
    expect(res.driftMinorUnits).toBe(100_000n);
  });

  it('currency mismatch (ledger USDT, chain asset USDC) → halt, not papered over', async () => {
    // The x402 target currency is USDC; a USDT-labelled ledger row must be
    // flagged as a real mismatch, never compared across currencies by decimals.
    await seedRevenueEvent(TX, 100_000n, 'USDT');
    const chain = readerWith(TX, confirmed(100_000n));
    const res = await reconcileOnce(pool, chain, CFG);
    expect(res.halted).toBe(true);
    expect(res.haltReason).toBe('LEDGER_CHAIN_CURRENCY_MISMATCH');
    expect(res.rows[0]?.status).toBe('currency_mismatch');
    expect(res.driftMinorUnits).toBe(100_000n);
  });

  it('resumes: a clean cycle clears a previously halted state', async () => {
    await seedRevenueEvent(TX, 100_000n);
    await pool.query(`UPDATE reconciliation_state SET halted=true, halt_reason='LEDGER_CHAIN_DRIFT', drift_minor_units=50000 WHERE id=1`);
    const out = await runCycle(pool, readerWith(TX, confirmed(100_000n)), CFG, noopDeliver, NOW);
    expect(out.snapshot.halted).toBe(false);
    expect(out.snapshot.driftMinorUnits).toBe(0n);
    const state = await readReconciliationState(pool);
    expect(state?.halted).toBe(false);
    expect(state?.halt_reason).toBeNull();
  });

  it('rollback-injection mechanism: altering the ledger inside a tx detects drift and persists nothing', async () => {
    await seedRevenueEvent(TX, 100_000n);
    const chain = readerWith(TX, confirmed(100_000n));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Injected drift: bump the credit so ledger (150000) ≠ chain (100000).
      await client.query(
        `UPDATE ledger_entries SET amount = 150000
           WHERE ref_id = $1 AND direction = 'credit'`,
        [REF],
      );
      const res = await reconcileOnce(client, chain, CFG);
      expect(res.driftMinorUnits).toBe(50_000n);
      expect(res.halted).toBe(true);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    // Nothing persisted: ledger unchanged, no outbox rows.
    const amt = await pool.query<{ amount: string }>(
      `SELECT amount FROM ledger_entries WHERE ref_id=$1 AND direction='credit'`,
      [REF],
    );
    expect(amt.rows[0]!.amount).toBe('100000');
    const ev = await pool.query(`SELECT count(*)::int AS n FROM outbox`);
    expect((ev.rows[0] as { n: number }).n).toBe(0);
  });
});

describe('settlement-poller', () => {
  it('advances a confirmed settling draw and counts stuck ones', async () => {
    const freshTx = '0x' + 'a'.repeat(64);
    await seedSettlingDraw({ drawId: 'draw_fresh', createdAt: NOW, railTxHash: freshTx, railNetwork: 'base' });
    // stuck: old, no advanceable tx
    await seedSettlingDraw({
      drawId: 'draw_stuck',
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      railTxHash: null,
      railNetwork: null,
    });
    const chain = readerWith(freshTx, confirmed(500n));
    const res = await pollOnce(pool, chain, CFG, NOW);
    expect(res.advancedCount).toBe(1);
    expect(res.stuckSettlementCount).toBe(1); // draw_stuck only; draw_fresh now settled
    const draw = await pool.query<{ state: string }>(`SELECT state FROM draws WHERE id='draw_fresh'`);
    expect(draw.rows[0]!.state).toBe('settled');
    const sett = await pool.query<{ state: string }>(`SELECT state FROM settlements WHERE draw_id='draw_fresh'`);
    expect(sett.rows[0]!.state).toBe('confirmed');
  });

  it('does not advance a settling draw whose tx is unconfirmed', async () => {
    const tx = '0x' + 'b'.repeat(64);
    await seedSettlingDraw({ drawId: 'draw_wait', createdAt: NOW, railTxHash: tx, railNetwork: 'base' });
    const chain = readerWith(tx, confirmed(500n, 1)); // 1 < 5
    const res = await pollOnce(pool, chain, CFG, NOW);
    expect(res.advancedCount).toBe(0);
    const draw = await pool.query<{ state: string }>(`SELECT state FROM draws WHERE id='draw_wait'`);
    expect(draw.rows[0]!.state).toBe('settling');
  });
});

describe('outbox-publisher', () => {
  it('is at-least-once and idempotent: delivers once, then nothing', async () => {
    await emitEvent(pool, { eventId: 'ev1', eventType: 'test.event', severity: 'info', payload: { a: 1 } });
    const delivered: OutboxEvent[] = [];
    const recording = async (e: OutboxEvent): Promise<void> => { delivered.push(e); };

    const first = await publishOnce(pool, recording);
    expect(first.publishedCount).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.eventId).toBe('ev1');

    const second = await publishOnce(pool, recording);
    expect(second.publishedCount).toBe(0);
    expect(delivered).toHaveLength(1); // not re-delivered
  });

  it('a failed delivery leaves the event unpublished for retry', async () => {
    await emitEvent(pool, { eventId: 'ev2', eventType: 'test.event', severity: 'info', payload: {} });
    const failing = async (): Promise<void> => { throw new Error('sink down'); };
    const res = await publishOnce(pool, failing);
    expect(res.publishedCount).toBe(0);
    expect(res.failedCount).toBe(1);
    const row = await pool.query(`SELECT published_at FROM outbox WHERE event_id='ev2'`);
    expect(row.rows[0]!.published_at).toBeNull();
    // retry with a working sink succeeds
    const ok = await publishOnce(pool, async () => undefined);
    expect(ok.publishedCount).toBe(1);
  });

  it('emitEvent dedupes on event_id', async () => {
    const a = await emitEvent(pool, { eventId: 'dup', eventType: 't', severity: 'info', payload: {} });
    const b = await emitEvent(pool, { eventId: 'dup', eventType: 't', severity: 'info', payload: {} });
    expect(a).toBe(true);
    expect(b).toBe(false);
  });
});
