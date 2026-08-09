/**
 * Integration tests for the plain-JS shadow ledger writer
 * (apps/api/src/ledger/shadow_ledger_write.js) against a real Postgres with all
 * migrations (001–005) applied.
 *
 * Verifies the M3 shadow-write guarantees:
 *   - flag OFF  => nothing is written (default-safe)
 *   - flag ON   => a balanced two-entry transaction is written; idempotent
 *   - is_test_data events are excluded (invariant #10)
 *   - a write failure NEVER throws to the caller (the sacred path is protected)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { migrate } from '../runner.js';
// Plain-JS runtime writer — imported exactly as apps/api uses it.
import {
  shadowWriteRevenueLedger,
  toMinorUnits,
  SUSPENSE_ACCOUNT_ID,
  REVENUE_ACCOUNT_ID,
} from '../../apps/api/src/ledger/shadow_ledger_write.js';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '..',
  'migrations',
);

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const connectionString = container.getConnectionUri();
  const result = await migrate(connectionString, MIGRATIONS_DIR);
  if (result.errors.length > 0) throw new Error(`migration failed: ${result.errors.join('; ')}`);
  pool = new Pool({ connectionString });
  // Swallow idle-client connection errors (e.g. a socket reset when the
  // testcontainer stops in afterAll) so they never surface as unhandled
  // rejections. Query errors still reject their own promises.
  pool.on('error', () => {});
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
  delete process.env.LEDGER_SHADOW_WRITE;
});

beforeEach(async () => {
  await pool.query('TRUNCATE ledger_entries RESTART IDENTITY CASCADE');
  delete process.env.LEDGER_SHADOW_WRITE;
});

async function countRows(refId: string): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM ledger_entries WHERE ref_id = $1', [
    refId,
  ]);
  return rows[0].n;
}

describe('toMinorUnits (no floating point)', () => {
  it('parses decimal strings and numbers, rejects non-positive/invalid', () => {
    expect(toMinorUnits('0.03')).toBe(30000n);
    expect(toMinorUnits('0.00003')).toBe(30n);
    expect(toMinorUnits('1')).toBe(1000000n);
    expect(toMinorUnits(0.001)).toBe(1000n);
    expect(toMinorUnits('0.0000001')).toBe(null); // truncates to 0 minor -> non-positive
    expect(toMinorUnits('0')).toBe(null);
    expect(toMinorUnits('-1')).toBe(null);
    expect(toMinorUnits('abc')).toBe(null);
  });
});

describe('shadowWriteRevenueLedger', () => {
  it('writes NOTHING when the flag is OFF (default)', async () => {
    const r = await shadowWriteRevenueLedger(pool, { requestId: 'rx_off', amountUsdt: '0.03' });
    expect(r).toEqual({ written: false, reason: 'flag_off' });
    expect(await countRows('rx_off')).toBe(0);
  });

  it('writes a balanced two-entry transaction when the flag is ON', async () => {
    process.env.LEDGER_SHADOW_WRITE = '1';
    const r = await shadowWriteRevenueLedger(pool, { requestId: 'rx_on', amountUsdt: '0.03' });
    expect(r.written).toBe(true);

    const { rows } = await pool.query<{ account_id: string; direction: string; amount: string; ref_type: string }>(
      `SELECT account_id, direction, amount, ref_type FROM ledger_entries WHERE txn_id = 'shadow:rx_on' ORDER BY direction`,
    );
    expect(rows).toHaveLength(2);
    const credit = rows.find((x) => x.direction === 'credit')!;
    const debit = rows.find((x) => x.direction === 'debit')!;
    expect(credit.account_id).toBe(REVENUE_ACCOUNT_ID);
    expect(debit.account_id).toBe(SUSPENSE_ACCOUNT_ID);
    expect(BigInt(credit.amount)).toBe(30000n);
    expect(BigInt(debit.amount)).toBe(BigInt(credit.amount)); // balanced
    expect(credit.ref_type).toBe('revenue_event');
  });

  it('is idempotent on the request id', async () => {
    process.env.LEDGER_SHADOW_WRITE = '1';
    await shadowWriteRevenueLedger(pool, { requestId: 'rx_idem', amountUsdt: '0.03' });
    await shadowWriteRevenueLedger(pool, { requestId: 'rx_idem', amountUsdt: '0.03' });
    expect(await countRows('rx_idem')).toBe(2); // still one txn (2 legs), not 4
  });

  it('excludes is_test_data events (founder wallets, invariant #10)', async () => {
    process.env.LEDGER_SHADOW_WRITE = '1';
    const r = await shadowWriteRevenueLedger(pool, {
      requestId: 'rx_test',
      amountUsdt: '0.03',
      isTestData: true,
    });
    expect(r).toEqual({ written: false, reason: 'test_data_excluded' });
    expect(await countRows('rx_test')).toBe(0);
  });

  it('does NOT throw when the write fails — returns cleanly to the caller', async () => {
    process.env.LEDGER_SHADOW_WRITE = '1';
    const brokenPool = {
      connect: async () => {
        throw new Error('boom: connection refused');
      },
    };
    // Must resolve, never reject.
    const r = await shadowWriteRevenueLedger(brokenPool, {
      requestId: 'rx_fail',
      amountUsdt: '0.03',
    });
    expect(r).toEqual({ written: false, reason: 'error' });
  });
});
