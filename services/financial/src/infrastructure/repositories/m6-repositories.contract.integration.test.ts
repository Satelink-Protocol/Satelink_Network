import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
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

// Read the test database URL ONLY. DATABASE_URL is never consulted — reading it
// here is what leaked 20 fixture rows into production (scripts/ops/OPS_LOG.md).
// The integration project's globalSetup (assert-test-db) has already proven this
// URL is set and carries __test_db_marker before this module is ever loaded.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set — integration tests require an explicit test database.');
}

class PostgresDrawRepoHarness implements DrawRepoHarness {
  readonly pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
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
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
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
