/**
 * PostgresLedgerRepository — maps the LedgerTransaction aggregate onto the M2
 * `ledger_entries` table (003). Append-only: it only ever INSERTs.
 *
 * A "transaction" is the set of rows sharing txn_id. Idempotency is provided by
 * the UNIQUE (idem_key, account_id, direction) index (003): post() uses
 * ON CONFLICT DO NOTHING, so re-posting the same transaction is a no-op.
 *
 * Amounts are NUMERIC(38,0) integer minor units — passed as strings from the
 * bigint minor units in Money, never as JS numbers.
 */

import type { Pool, PoolClient } from 'pg';
import {
  LedgerTransaction,
  TxnId,
  AccountRef,
  Direction,
  EntryState,
  SourceReference,
} from '@satelink/financial-domain';
import type { LedgerEntryInput, LedgerEntryView } from '@satelink/financial-domain';
import { Money, Currency } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type {
  LedgerRepository,
  LedgerRepositoryError,
  TimeRange,
} from '../../../application/ports/ledger-repository.js';
import { ledgerRepositoryError } from '../../../application/ports/ledger-repository.js';

interface LedgerRow {
  readonly id: string;
  readonly txn_id: string;
  readonly account_id: string;
  readonly direction: string;
  readonly amount: string;
  readonly currency: string;
  readonly state: string;
  readonly ref_type: string;
  readonly ref_id: string;
  readonly reverses_entry_id: string | null;
}

export class PostgresLedgerRepository implements LedgerRepository {
  constructor(private readonly pool: Pool) {}

  async post(txn: LedgerTransaction): Promise<Result<void, LedgerRepositoryError>> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      // Insert ledger_txns header (parent of ledger_entries via FK).
      const firstEntry = txn.entries[0]!;
      await client.query(
        `INSERT INTO ledger_txns
           (txn_id, kind, ref_type, ref_id, currency, state, posted_at)
         VALUES ($1, 'deposit', $2, $3, $4, $5, $6)
         ON CONFLICT (txn_id) DO NOTHING`,
        [
          txn.txnId.value,
          firstEntry.source.refType,
          firstEntry.source.refId,
          txn.currency.code,
          firstEntry.state.value,
          firstEntry.state.isPosted() ? new Date() : null,
        ],
      );
      const entries = txn.entries;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        const idemKey = `${txn.txnId.value}#${i}`;
        await client.query(
          `INSERT INTO ledger_entries
             (txn_id, account_id, direction, amount, currency, state,
              ref_type, ref_id, reverses_entry_id, idem_key, posted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (idem_key, account_id, direction) DO NOTHING`,
          [
            txn.txnId.value,
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
      await client.query('COMMIT');
      return ok(undefined);
    } catch (cause) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback failure; surface the original cause
        }
      }
      return err(ledgerRepositoryError('post failed', cause));
    } finally {
      client?.release();
    }
  }

  async findByTxnId(id: string): Promise<Result<LedgerTransaction | null, LedgerRepositoryError>> {
    try {
      const { rows } = await this.pool.query<LedgerRow>(
        `SELECT id, txn_id, account_id, direction, amount, currency, state,
                ref_type, ref_id, reverses_entry_id
           FROM ledger_entries WHERE txn_id = $1 ORDER BY id`,
        [id],
      );
      if (rows.length === 0) {
        return ok(null);
      }

      const inputs: LedgerEntryInput[] = [];
      for (const row of rows) {
        const mapped = PostgresLedgerRepository.rowToInput(row);
        if (mapped.isErr) {
          return mapped;
        }
        inputs.push(mapped.value);
      }

      const txnIdResult = TxnId.of(id);
      if (txnIdResult.isErr) {
        return err(ledgerRepositoryError(`invalid stored txn id: ${txnIdResult.error.toString()}`));
      }
      const source = inputs[0]!.source;
      const rebuilt = LedgerTransaction.reconstitute({
        txnId: txnIdResult.value,
        source,
        entries: inputs,
      });
      if (rebuilt.isErr) {
        return err(
          ledgerRepositoryError(`stored transaction no longer valid: ${rebuilt.error.toString()}`),
        );
      }
      return ok(rebuilt.value);
    } catch (cause) {
      return err(ledgerRepositoryError('findByTxnId failed', cause));
    }
  }

  async streamByAccount(
    accountId: string,
    range: TimeRange,
  ): Promise<Result<readonly LedgerEntryView[], LedgerRepositoryError>> {
    try {
      const clauses = ['account_id = $1'];
      const params: unknown[] = [accountId];
      if (range.since !== undefined) {
        params.push(range.since);
        clauses.push(`created_at >= $${params.length}`);
      }
      if (range.until !== undefined) {
        params.push(range.until);
        clauses.push(`created_at <= $${params.length}`);
      }
      const { rows } = await this.pool.query<LedgerRow>(
        `SELECT id, txn_id, account_id, direction, amount, currency, state,
                ref_type, ref_id, reverses_entry_id
           FROM ledger_entries
          WHERE ${clauses.join(' AND ')}
          ORDER BY created_at, id`,
        params,
      );

      const views: LedgerEntryView[] = [];
      for (const row of rows) {
        const mapped = PostgresLedgerRepository.rowToInput(row);
        if (mapped.isErr) {
          return mapped;
        }
        const input = mapped.value;
        views.push({
          account: input.account,
          direction: input.direction,
          amount: input.amount,
          state: input.state,
          source: input.source,
          reversesEntryId: input.reversesEntryId,
          entryId: input.entryId,
        });
      }
      return ok(views);
    } catch (cause) {
      return err(ledgerRepositoryError('streamByAccount failed', cause));
    }
  }

  private static rowToInput(row: LedgerRow): Result<LedgerEntryInput, LedgerRepositoryError> {
    const account = AccountRef.of(row.account_id);
    if (account.isErr) return err(ledgerRepositoryError(account.error.toString()));
    const direction = Direction.of(row.direction);
    if (direction.isErr) return err(ledgerRepositoryError(direction.error.toString()));
    const state = EntryState.of(row.state);
    if (state.isErr) return err(ledgerRepositoryError(state.error.toString()));
    const currency = Currency.of(row.currency);
    if (currency.isErr) return err(ledgerRepositoryError(currency.error.toString()));
    const source = SourceReference.of(row.ref_type, row.ref_id);
    if (source.isErr) return err(ledgerRepositoryError(source.error.toString()));

    let amountMinor: bigint;
    try {
      amountMinor = BigInt(row.amount);
    } catch (cause) {
      return err(ledgerRepositoryError(`invalid amount "${row.amount}"`, cause));
    }

    return ok({
      account: account.value,
      direction: direction.value,
      amount: Money.fromMinorUnits(amountMinor, currency.value),
      state: state.value,
      source: source.value,
      reversesEntryId: row.reverses_entry_id ?? undefined,
      entryId: row.id,
    });
  }
}
