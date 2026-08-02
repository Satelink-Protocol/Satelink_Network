/**
 * PostgresAccountRepository — maps the Account aggregate onto the accounts table
 * (002) + the version column (006). Optimistic locking as in the principal repo.
 * The (principal_id, kind, currency) uniqueness rule is enforced by the DB
 * unique index (002); a duplicate INSERT surfaces as a RepositoryError.
 */

import type { Pool } from 'pg';
import type { Account } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { AccountRepository } from '../../../application/ports/account-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { repositoryError, staleVersionError } from '../../../application/ports/repository-errors.js';
import { accountToRow, rowToAccount, type AccountRow } from '../account-mapper.js';

const COLS =
  'id, principal_id, kind, normality, currency, decimals, balance_invariant, state, version';

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<Result<Account | null, RepositoryError>> {
    return this.findOne(`SELECT ${COLS} FROM accounts WHERE id = $1`, [id]);
  }

  async findByPrincipal(principalId: string): Promise<Result<readonly Account[], RepositoryError>> {
    try {
      const { rows } = await this.pool.query<AccountRow>(
        `SELECT ${COLS} FROM accounts WHERE principal_id = $1 ORDER BY id`,
        [principalId],
      );
      const out: Account[] = [];
      for (const row of rows) {
        const r = rowToAccount(row);
        if (r.isErr) return r;
        out.push(r.value);
      }
      return ok(out);
    } catch (cause) {
      return err(repositoryError('findByPrincipal failed', cause));
    }
  }

  async findByPrincipalKindCurrency(
    principalId: string,
    kind: string,
    currency: string,
  ): Promise<Result<Account | null, RepositoryError>> {
    return this.findOne(
      `SELECT ${COLS} FROM accounts WHERE principal_id=$1 AND kind=$2 AND currency=$3`,
      [principalId, kind, currency],
    );
  }

  async save(account: Account): Promise<Result<void, WriteError>> {
    const row = accountToRow(account);
    try {
      const upd = await this.pool.query(
        `UPDATE accounts
            SET principal_id=$2, kind=$3, normality=$4, currency=$5, decimals=$6,
                balance_invariant=$7, state=$8, version=version+1
          WHERE id=$1 AND version=$9`,
        [
          row.id, row.principal_id, row.kind, row.normality, row.currency,
          row.decimals, row.balance_invariant, row.state, row.version,
        ],
      );
      if ((upd.rowCount ?? 0) > 0) return ok(undefined);

      const exists = await this.pool.query('SELECT 1 FROM accounts WHERE id=$1', [row.id]);
      if (exists.rows.length > 0) return err(staleVersionError(row.id, row.version));

      await this.pool.query(
        `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals, balance_invariant, state, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          row.id, row.principal_id, row.kind, row.normality, row.currency,
          row.decimals, row.balance_invariant, row.state, row.version + 1,
        ],
      );
      return ok(undefined);
    } catch (cause) {
      return err(repositoryError('save failed', cause));
    }
  }

  private async findOne(
    sql: string,
    params: unknown[],
  ): Promise<Result<Account | null, RepositoryError>> {
    try {
      const { rows } = await this.pool.query<AccountRow>(sql, params);
      if (rows.length === 0) return ok(null);
      const r = rowToAccount(rows[0]!);
      return r.isErr ? r : ok(r.value);
    } catch (cause) {
      return err(repositoryError('query failed', cause));
    }
  }
}
