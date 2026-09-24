import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from '../../../../../database/__tests__/apply-migrations.js';
import { runDrawRepositoryContract } from './draw-repository.contract.js';
import type { DrawRepoHarness } from './draw-repository.contract.js';
import { PostgresDrawRepository } from './postgres/postgres-draw-repository.js';
import { PostgresUnitOfWork } from './postgres/postgres-unit-of-work.js';
import { PostgresLedgerRepository } from './postgres/postgres-ledger-repository.js';
import {
  Draw,
  DrawId,
  PrincipalId,
  AuthorizationId,
  FundingSourceId,
  AccountId,
  ConfirmationCount,
  LedgerTransaction,
  TxnId,
  RailTransaction,
  Direction,
  EntryState,
  SourceReference,
} from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { Money, USDT } from '@satelink/kernel';

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}

// ---------------------------------------------------------------------------
// Ephemeral Postgres via testcontainers — matching the other 12 integration
// tests. Migrations 001–009 are applied to the fresh container so the
// ledger_entries→ledger_txns FK, the deferred balance trigger, and the
// accounts.state CHECK are all present. The production DATABASE_URL env var is
// NEVER read (reading it is what leaked fixtures into production —
// scripts/ops/OPS_LOG.md); the marker guard (integration globalSetup) still
// gates the suite as defense in depth.
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../../../../database/migrations',
);

let container: StartedPostgreSqlContainer;
let connectionString: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  connectionString = container.getConnectionUri();
  const result = await applyMigrationsForTest(connectionString, MIGRATIONS_DIR);
  if (result.errors.length > 0) {
    throw new Error(`migration failed: ${result.errors.join('; ')}`);
  }
}, 120_000);

afterAll(async () => {
  await container?.stop().catch(() => undefined);
});

class PostgresDrawRepoHarness implements DrawRepoHarness {
  readonly pool = new pg.Pool({ connectionString });
  readonly repo = new PostgresDrawRepository(this.pool);

  async ensurePrincipal(id: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO principals (id, kind, state) VALUES ($1, 'human', 'active') ON CONFLICT (id) DO NOTHING`,
      [id]
    );
  }

  async ensureFundingSource(id: string, principalId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state)
       VALUES ($1, $2, 'test_rail', '{"ref":"test"}', 'authorization', '{}', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [id, principalId]
    );
  }

  async ensureAuthorization(id: string, principalId: string, fundingSourceId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO authorizations (id, principal_id, funding_source_id, cap_amount, currency, valid_after, valid_before, signature_envelope, state)
       VALUES ($1, $2, $3, 1000000000, 'USDT', 0, 9999999999999, '{"scheme":"test","signature":"0x","signer":"0x"}', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [id, principalId, fundingSourceId]
    );
  }

  async ensureAccount(id: string, principalId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals, state)
       VALUES ($1, $2, 'liability', 'credit', 'USDT', 6, 'open')
       ON CONFLICT (id) DO NOTHING`,
      [id, principalId]
    );
  }

  async reset(): Promise<void> {
    await this.pool.query('DELETE FROM settlements');
    await this.pool.query('DELETE FROM draws');
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

runDrawRepositoryContract('postgres', async () => new PostgresDrawRepoHarness());

describe('PostgresUnitOfWork integration', () => {
  let pool: pg.Pool;
  let harness: PostgresDrawRepoHarness;
  let uow: PostgresUnitOfWork;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString });
    harness = new PostgresDrawRepoHarness();
    await harness.ensurePrincipal('prn_uow');
    await harness.ensureFundingSource('fs_uow', 'prn_uow');
    await harness.ensureAuthorization('auth_uow', 'prn_uow', 'fs_uow');
    await harness.ensureAccount('acct_uow', 'prn_uow');
    await harness.ensurePrincipal('sys_root');
    await pool.query(
      `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals, state)
       VALUES ('acct_revenue', 'sys_root', 'revenue', 'credit', 'USDT', 6, 'open')
       ON CONFLICT (id) DO NOTHING`
    );
    uow = new PostgresUnitOfWork(pool);
  });

  afterAll(async () => {
    await harness.dispose();
    await pool.end();
  });

  it('commits Draw and LedgerTransaction atomically', async () => {
    let d = must(
      Draw.create({
        id: must(DrawId.of('draw_uow_1')),
        principalId: must(PrincipalId.of('prn_uow')),
        authorizationId: must(AuthorizationId.of('auth_uow')),
        fundingSourceId: must(FundingSourceId.of('fs_uow')),
        accountId: must(AccountId.of('acct_uow')),
        amount: Money.fromMinorUnits(500n, USDT),
        idempotencyKey: 'idem_uow_1',
        createdAt: 1000,
      })
    );
    d = must(d.authorize());
    d = must(d.beginSettlement(must(ConfirmationCount.of(0))));
    d = must(d.submitSettlement(must(RailTransaction.of('0xhash', 'base', 0))));
    d = must(d.addConfirmations(must(ConfirmationCount.of(0))));
    d = must(d.confirmSettlement(must(ConfirmationCount.of(0)), Date.now()));

    const ledgerTx = must(
      LedgerTransaction.create({
        txnId: must(TxnId.of('txn_uow_1')),
        kind: 'draw',
        source: must(SourceReference.of('draw', 'txn_uow_1')),
        entries: [
          {
            account: must(AccountId.of('acct_uow')),
            direction: must(Direction.of('credit')),
            amount: Money.fromMinorUnits(500n, USDT),
            state: EntryState.POSTED,
            source: must(SourceReference.of('draw', 'txn_uow_1')),
          },
          {
            account: must(AccountId.of('acct_revenue')),
            direction: must(Direction.of('debit')),
            amount: Money.fromMinorUnits(500n, USDT),
            state: EntryState.POSTED,
            source: must(SourceReference.of('draw', 'txn_uow_1')),
          },
        ],
      })
    );

    const result = await uow.commitDrawAndLedger(d, ledgerTx);
    if (result.isErr) {
      console.log('UoW ERROR:', result.error);
    }
    expect(result.isOk).toBe(true);

    // Verify Draw saved
    const drawRepo = new PostgresDrawRepository(pool);
    const foundDraw = must(await drawRepo.findById('draw_uow_1'));
    expect(foundDraw?.state.value).toBe('settled');

    // Verify Ledger saved
    const ledgerRepo = new PostgresLedgerRepository(pool);
    const foundLedger = must(await ledgerRepo.findByTxnId('txn_uow_1'));
    expect(foundLedger?.entries[0]?.state.value).toBe('posted');
  });

  it('rolls back both if ledger insertion fails (database rejection)', async () => {
    let d = must(
      Draw.create({
        id: must(DrawId.of('draw_uow_2')),
        principalId: must(PrincipalId.of('prn_uow')),
        authorizationId: must(AuthorizationId.of('auth_uow')),
        fundingSourceId: must(FundingSourceId.of('fs_uow')),
        accountId: must(AccountId.of('acct_uow')),
        amount: Money.fromMinorUnits(500n, USDT),
        idempotencyKey: 'idem_uow_2',
        createdAt: 1000,
      })
    );

    const ledgerTx = {
      txnId: must(TxnId.of('txn_uow_2')),
      source: must(SourceReference.of('draw', 'txn_uow_2')),
      currency: USDT,
      entryCount: 1,
      entries: [
        {
          entryId: 'fake_entry_id',
          account: must(AccountId.of('acct_does_not_exist')), // Foreign key violation
          direction: must(Direction.of('credit')),
          amount: Money.fromMinorUnits(500n, USDT),
          state: EntryState.POSTED,
          source: must(SourceReference.of('draw', 'txn_uow_2')),
          reversesEntryId: undefined,
        },
      ],
    } as any as LedgerTransaction;

    const result = await uow.commitDrawAndLedger(d, ledgerTx);
    expect(result.isErr).toBe(true);

    // Verify neither saved
    const drawRepo = new PostgresDrawRepository(pool);
    const foundDraw = must(await drawRepo.findById('draw_uow_2'));
    expect(foundDraw).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M6.5 schema gates (migration 009): the ledger_entries→ledger_txns FK and the
// deferred balance-check trigger. These constraints ship in 009 but no
// integration test exercised them until now — this block runs them against a
// real Postgres. assertUniformLedgerHeader (the JS persistence guard) is also
// exercised end-to-end through PostgresLedgerRepository.post().
// ---------------------------------------------------------------------------

describe('M6.5 ledger_txns FK + deferred balance trigger (migration 009)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString });
    // Two accounts under one principal (distinct kinds so the
    // (principal_id, kind, currency) unique index is satisfied).
    await pool.query(
      `INSERT INTO principals (id, kind, state) VALUES ('prn_trg', 'human', 'active') ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals, state)
       VALUES ('acct_trg_a', 'prn_trg', 'liability', 'credit', 'USDT', 6, 'open') ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals, state)
       VALUES ('acct_trg_b', 'prn_trg', 'revenue', 'credit', 'USDT', 6, 'open') ON CONFLICT (id) DO NOTHING`
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('FK: a ledger_entries row with no parent ledger_txns is rejected', async () => {
    await expect(
      pool.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
         VALUES ('txn_orphan', 'acct_trg_a', 'debit', 100, 'USDT', 'posted', 'draw', 'r0', 'idem_fk_orphan')`
      )
    ).rejects.toThrow(/foreign key/i);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE txn_id = 'txn_orphan'`
    );
    expect(rows[0].n).toBe(0);
  });

  it('deferred balance trigger: a balanced transaction COMMITs', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ledger_txns (txn_id, kind, ref_type, ref_id, currency, state)
         VALUES ('txn_bal_ok', 'deposit', 'draw', 'r1', 'USDT', 'posted')`
      );
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
         VALUES ('txn_bal_ok', 'acct_trg_a', 'debit', 100, 'USDT', 'posted', 'draw', 'r1', 'idem_ok_d')`
      );
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
         VALUES ('txn_bal_ok', 'acct_trg_b', 'credit', 100, 'USDT', 'posted', 'draw', 'r1', 'idem_ok_c')`
      );
      // The trigger is DEFERRABLE INITIALLY DEFERRED — it runs here, at COMMIT.
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE txn_id = 'txn_bal_ok'`
    );
    expect(rows[0].n).toBe(2);
  });

  it('deferred balance trigger: an unbalanced transaction is REJECTED at COMMIT', async () => {
    const client = await pool.connect();
    let threw = false;
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ledger_txns (txn_id, kind, ref_type, ref_id, currency, state)
         VALUES ('txn_bal_bad', 'deposit', 'draw', 'r2', 'USDT', 'posted')`
      );
      // Single debit, no matching credit → SUM(debit) <> SUM(credit).
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
         VALUES ('txn_bal_bad', 'acct_trg_a', 'debit', 100, 'USDT', 'posted', 'draw', 'r2', 'idem_bad_d')`
      );
      await client.query('COMMIT'); // trigger fires here and must raise
    } catch (e) {
      threw = true;
      expect(String((e as Error).message)).toMatch(/ledger balance violation/i);
      await client.query('ROLLBACK').catch(() => undefined);
    } finally {
      client.release();
    }
    expect(threw).toBe(true);

    // The aborted transaction persisted nothing.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE txn_id = 'txn_bal_bad'`
    );
    expect(rows[0].n).toBe(0);
  });

  it('assertUniformLedgerHeader: repo.post rejects entries that disagree on the header', async () => {
    const repo = new PostgresLedgerRepository(pool);
    // Amounts balance, but the two legs disagree on ref_id — the header would be
    // derived from entries[0] and misdescribe the second leg. The aggregate
    // permits heterogeneous sources; the persistence guard does not.
    const txn = must(
      LedgerTransaction.create({
        txnId: must(TxnId.of('txn_hdr_mismatch')),
        kind: 'deposit',
        source: must(SourceReference.of('draw', 'r3a')),
        entries: [
          {
            account: must(AccountId.of('acct_trg_a')),
            direction: Direction.DEBIT,
            amount: Money.fromMinorUnits(100n, USDT),
            state: EntryState.POSTED,
            source: must(SourceReference.of('draw', 'r3a')),
          },
          {
            account: must(AccountId.of('acct_trg_b')),
            direction: Direction.CREDIT,
            amount: Money.fromMinorUnits(100n, USDT),
            state: EntryState.POSTED,
            source: must(SourceReference.of('draw', 'r3b')),
          },
        ],
      })
    );

    const res = await repo.post(txn);
    expect(res.isErr).toBe(true);

    // Guard throws before the header INSERT, so nothing is written.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE txn_id = 'txn_hdr_mismatch'`
    );
    expect(rows[0].n).toBe(0);
  });
});
