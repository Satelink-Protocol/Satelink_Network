import type { Pool, PoolClient } from 'pg';
import type { Draw, LedgerTransaction } from '@satelink/financial-domain';
import { assertUniformLedgerHeader } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { UnitOfWork } from '../../../application/ports/unit-of-work.js';
import { WriteError } from '../../../application/ports/unit-of-work.js';
import { PostgresDrawRepository } from './postgres-draw-repository.js';
import { PostgresLedgerRepository } from './postgres-ledger-repository.js'; // Assuming this exists from M1-M3

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async commitDrawAndLedger(draw: Draw, ledgerTxn: LedgerTransaction): Promise<Result<void, WriteError>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      const drawRepo = new PostgresDrawRepository(client);

      const dRes = await drawRepo.save(draw);
      if (dRes.isErr) {
        await client.query('ROLLBACK');
        return err(new WriteError('failed to save draw in UnitOfWork', dRes.error));
      }

      // Inline ledger entries post to use the UoW client transaction
      try {
        // The header's ref_type/ref_id/state are derived from entries[0]; every
        // entry must agree or the header would misdescribe the transaction.
        assertUniformLedgerHeader(ledgerTxn.txnId.value, ledgerTxn.entries);
        // Insert ledger_txns header (parent of ledger_entries via FK). This
        // path only ever commits a draw, so kind is draw — never a deposit.
        const firstEntry = ledgerTxn.entries[0]!;
        await client.query(
          `INSERT INTO ledger_txns
             (txn_id, kind, ref_type, ref_id, currency, state, posted_at)
           VALUES ($1, 'draw', $2, $3, $4, $5, $6)
           ON CONFLICT (txn_id) DO NOTHING`,
          [
            ledgerTxn.txnId.value,
            firstEntry.source.refType,
            firstEntry.source.refId,
            ledgerTxn.currency.code,
            firstEntry.state.value,
            firstEntry.state.isPosted() ? new Date() : null,
          ],
        );
        for (let i = 0; i < ledgerTxn.entryCount; i++) {
          const e = ledgerTxn.entries[i]!;
          const idemKey = `${ledgerTxn.txnId.value}#${i}`;
          await client.query(
            `INSERT INTO ledger_entries
               (txn_id, account_id, direction, amount, currency, state,
                ref_type, ref_id, reverses_entry_id, idem_key, posted_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (idem_key, account_id, direction) DO NOTHING`,
            [
              ledgerTxn.txnId.value,
              e.account.value,
              e.direction.value,
              e.amount.amount.toString(),
              e.amount.currency.code,
              e.state.value,
              e.source.refType,
              e.source.refId,
              e.reversesEntryId ?? null,
              idemKey,
              e.state.isPosted() ? new Date() : null,
            ],
          );
        }
      } catch (e) {
        await client.query('ROLLBACK');
        return err(new WriteError('failed to post ledger transaction in UnitOfWork', e));
      }

      await client.query('COMMIT');
      return ok(undefined);
    } catch (e) {
      await client.query('ROLLBACK');
      return err(new WriteError('UnitOfWork transaction failed with unexpected error', e));
    } finally {
      client.release();
    }
  }
}
