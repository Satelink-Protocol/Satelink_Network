/**
 * Postgres LedgerRepository: runs the SHARED contract against a real Postgres
 * (testcontainers), plus the balance-view regression test — proving
 * BalanceCalculator agrees EXACTLY with the M2 account_balances SQL view (this
 * is the guard for the DECISION 1 formula mismatch).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { migrate } from '../../../../../../database/runner.js';
import { PostgresLedgerRepository } from './postgres-ledger-repository.js';
import { runLedgerRepositoryContract } from '../ledger-repository.contract.js';
import {
  LedgerTransaction,
  TxnId,
  AccountRef,
  SourceReference,
  EntryState,
  Direction,
  BalanceCalculator,
} from '@satelink/financial-domain';
import { Money, USDT } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../../../../../database/migrations',
);

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const connectionString = container.getConnectionUri();
  const result = await migrate(connectionString, MIGRATIONS_DIR);
  if (result.errors.length > 0) {
    throw new Error(`migration failed: ${result.errors.join('; ')}`);
  }
  pool = new Pool({ connectionString });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
});

async function ensureAccount(accountId: string): Promise<void> {
  // One principal per account so the (principal_id, kind, currency) unique index
  // on accounts is never violated when several test accounts are created.
  const principalId = `prn_${accountId}`;
  await pool.query(
    `INSERT INTO principals (id, kind) VALUES ($1, 'machine') ON CONFLICT (id) DO NOTHING`,
    [principalId],
  );
  await pool.query(
    `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals)
     VALUES ($1, $2, 'wallet', 'credit', 'USDT', 6) ON CONFLICT (id) DO NOTHING`,
    [accountId, principalId],
  );
}

// --- shared contract against Postgres ---------------------------------------

runLedgerRepositoryContract('Postgres', async () => ({
  repo: new PostgresLedgerRepository(pool),
  ensureAccount,
  reset: async () => {
    await pool.query('TRUNCATE ledger_entries RESTART IDENTITY CASCADE');
  },
  dispose: async () => {
    /* container + pool owned by the file-level afterAll */
  },
}));

// --- balance-view regression (DECISION 1) -----------------------------------

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}

describe('BalanceCalculator agrees with the SQL account_balances view', () => {
  it('posted credit, posted debit, and pending debit reconcile exactly', async () => {
    await pool.query('TRUNCATE ledger_entries RESTART IDENTITY CASCADE');
    await ensureAccount('acct_bal');
    await ensureAccount('acct_other');
    const repo = new PostgresLedgerRepository(pool);
    const src = must(SourceReference.of('revenue_event', 'ev_bal'));

    // posted credit 1000 to acct_bal
    await repo.post(
      must(
        LedgerTransaction.transfer({
          txnId: must(TxnId.of('txn_bal_credit')),
          source: src,
          debitAccount: must(AccountRef.of('acct_other')),
          creditAccount: must(AccountRef.of('acct_bal')),
          amount: Money.fromMinorUnits(1000n, USDT),
          state: EntryState.POSTED,
        }),
      ),
    );
    // posted debit 300 from acct_bal
    await repo.post(
      must(
        LedgerTransaction.transfer({
          txnId: must(TxnId.of('txn_bal_debit')),
          source: src,
          debitAccount: must(AccountRef.of('acct_bal')),
          creditAccount: must(AccountRef.of('acct_other')),
          amount: Money.fromMinorUnits(300n, USDT),
          state: EntryState.POSTED,
        }),
      ),
    );
    // pending debit 200 from acct_bal
    await repo.post(
      must(
        LedgerTransaction.create({
          txnId: must(TxnId.of('txn_bal_pending')),
          source: src,
          entries: [
            {
              account: must(AccountRef.of('acct_bal')),
              direction: Direction.DEBIT,
              amount: Money.fromMinorUnits(200n, USDT),
              state: EntryState.PENDING,
              source: src,
            },
            {
              account: must(AccountRef.of('acct_other')),
              direction: Direction.CREDIT,
              amount: Money.fromMinorUnits(200n, USDT),
              state: EntryState.PENDING,
              source: src,
            },
          ],
        }),
      ),
    );

    // Domain view of the balance.
    const stream = await repo.streamByAccount('acct_bal', {});
    expect(stream.isOk).toBe(true);
    if (!stream.isOk) return;
    const calc = must(
      BalanceCalculator.compute(must(AccountRef.of('acct_bal')), USDT, stream.value),
    );

    // SQL view of the same balance.
    const { rows } = await pool.query<{
      posted_balance: string;
      available_balance: string;
    }>(`SELECT posted_balance, available_balance FROM account_balances WHERE account_id = 'acct_bal'`);
    expect(rows).toHaveLength(1);
    const view = rows[0]!;

    // Exact agreement — this is the regression guard.
    expect(calc.available.amount).toBe(500n); // 1000 - 300 - 200
    expect(calc.postedBalance.amount).toBe(700n); // 1000 - 300
    expect(BigInt(view.available_balance)).toBe(calc.available.amount);
    expect(BigInt(view.posted_balance)).toBe(calc.postedBalance.amount);
  });
});
