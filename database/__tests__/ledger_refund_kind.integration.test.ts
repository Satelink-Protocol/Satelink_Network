/**
 * fix/ledger-refund-kind — refund reversals must land in the ledger.
 * Real Postgres: a testcontainer, or (no Docker) a fresh database on the
 * server in LEDGER_TEST_DB (e.g. postgresql://postgres@127.0.0.1:55432/postgres).
 *
 *   - with migrations through 018 (production today) the refund write FAILS the
 *     kind CHECK and is swallowed — the bug, reproduced;
 *   - with 019, full and partial refunds post balanced 'refund' transactions,
 *     the revenue account nets correctly, and replays are idempotent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
import { isLedgerKind, LEDGER_KINDS } from '../../libs/financial-domain/src/ledger/ledger-kind.js';
import {
  shadowWriteRevenueLedger,
  shadowReverseRevenueLedger,
  REVENUE_ACCOUNT_ID,
  SUSPENSE_ACCOUNT_ID,
} from '../../apps/api/src/ledger/shadow_ledger_write.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', 'migrations');

let container: StartedPostgreSqlContainer | undefined;
const created: string[] = [];
let adminUrl = '';

async function freshDb(name: string): Promise<string> {
  if (!adminUrl) {
    if (process.env.LEDGER_TEST_DB) adminUrl = process.env.LEDGER_TEST_DB;
    else {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      adminUrl = container.getConnectionUri();
    }
  }
  const db = `${name}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  await c.query(`CREATE DATABASE ${db}`);
  await c.end();
  created.push(db);
  const u = new URL(adminUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

async function balanceOf(pool: Pool, account: string): Promise<bigint> {
  const { rows } = await pool.query<{ d: string | null; c: string | null }>(
    `SELECT SUM(amount) FILTER (WHERE direction='debit') d, SUM(amount) FILTER (WHERE direction='credit') c
       FROM ledger_entries WHERE account_id = $1`,
    [account],
  );
  return BigInt(rows[0].c ?? 0) - BigInt(rows[0].d ?? 0);
}

beforeAll(() => { process.env.LEDGER_SHADOW_WRITE = '1'; });
afterAll(async () => {
  delete process.env.LEDGER_SHADOW_WRITE;
  if (adminUrl && !container) {
    const c = new Client({ connectionString: adminUrl });
    await c.connect();
    for (const db of created) await c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => undefined);
    await c.end();
  }
  await container?.stop().catch(() => undefined);
});

describe('LedgerKind', () => {
  it("includes 'refund' and still mirrors the CHECK constraint", () => {
    expect(LEDGER_KINDS).toContain('refund');
    expect(isLedgerKind('refund')).toBe(true);
    expect(isLedgerKind('chargeback')).toBe(false);
  });
});

describe('refund reversals reach the ledger', () => {
  it('BEFORE 019 (prod today): the refund write fails the kind CHECK and is swallowed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig018-'));
    for (const f of readdirSync(MIGRATIONS_DIR)) if (f < '019') cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const url = await freshDb('ledger_pre019');
    const r0 = await applyMigrationsForTest(url, dir);
    expect(r0.errors).toEqual([]);
    const pool = new Pool({ connectionString: url });
    pool.on('error', () => {});
    try {
      expect((await shadowWriteRevenueLedger(pool, { requestId: 'dodo:pay_1', amountUsdt: '19' })).written).toBe(true);
      const r = await shadowReverseRevenueLedger(pool, { requestId: 'dodo:refund:ref_1', amountUsdt: '19' }, { error() {} });
      expect(r.written).toBe(false);
      const { rows } = await pool.query(`SELECT count(*)::int n FROM ledger_txns WHERE kind = 'refund'`);
      expect(rows[0].n).toBe(0);
    } finally {
      await pool.end();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('WITH 019: full refund posts a balanced refund txn and nets revenue to zero', async () => {
    const url = await freshDb('ledger_full');
    expect((await applyMigrationsForTest(url, MIGRATIONS_DIR)).errors).toEqual([]);
    const pool = new Pool({ connectionString: url });
    pool.on('error', () => {});
    try {
      await shadowWriteRevenueLedger(pool, { requestId: 'dodo:pay_full', amountUsdt: '19' });
      expect(await balanceOf(pool, REVENUE_ACCOUNT_ID)).toBe(19_000_000n);
      const r = await shadowReverseRevenueLedger(pool, { requestId: 'dodo:refund:ref_full', amountUsdt: '19' });
      expect(r.written).toBe(true);
      const txn = (await pool.query(`SELECT kind, state, ref_type FROM ledger_txns WHERE txn_id = 'shadow-reversal:dodo:refund:ref_full'`)).rows[0];
      expect(txn).toEqual({ kind: 'refund', state: 'posted', ref_type: 'revenue_reversal' });
      const legs = (await pool.query(`SELECT direction, amount FROM ledger_entries WHERE txn_id = 'shadow-reversal:dodo:refund:ref_full'`)).rows;
      expect(legs).toHaveLength(2);
      expect(BigInt(legs[0].amount)).toBe(BigInt(legs[1].amount));
      expect(await balanceOf(pool, REVENUE_ACCOUNT_ID)).toBe(0n);
      expect(await balanceOf(pool, SUSPENSE_ACCOUNT_ID)).toBe(0n);
      // Replay (webhook redelivery) changes nothing.
      await shadowReverseRevenueLedger(pool, { requestId: 'dodo:refund:ref_full', amountUsdt: '19' });
      expect((await pool.query(`SELECT count(*)::int n FROM ledger_txns WHERE kind = 'refund'`)).rows[0].n).toBe(1);
      expect(await balanceOf(pool, REVENUE_ACCOUNT_ID)).toBe(0n);
    } finally {
      await pool.end();
    }
  }, 120_000);

  it('WITH 019: partial refund leaves the unrefunded revenue', async () => {
    const url = await freshDb('ledger_partial');
    expect((await applyMigrationsForTest(url, MIGRATIONS_DIR)).errors).toEqual([]);
    const pool = new Pool({ connectionString: url });
    pool.on('error', () => {});
    try {
      await shadowWriteRevenueLedger(pool, { requestId: 'dodo:pay_part', amountUsdt: '50' });
      const r = await shadowReverseRevenueLedger(pool, { requestId: 'dodo:refund:ref_part', amountUsdt: '20' });
      expect(r.written).toBe(true);
      expect(await balanceOf(pool, REVENUE_ACCOUNT_ID)).toBe(30_000_000n);
      const kinds = (await pool.query(`SELECT kind, count(*)::int n FROM ledger_txns GROUP BY kind ORDER BY kind`)).rows;
      expect(kinds).toEqual([{ kind: 'deposit', n: 1 }, { kind: 'refund', n: 1 }]);
    } finally {
      await pool.end();
    }
  }, 120_000);
});
