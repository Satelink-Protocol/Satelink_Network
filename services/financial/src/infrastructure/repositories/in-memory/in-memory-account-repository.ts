/**
 * InMemoryAccountRepository — in-memory double for the Account aggregate.
 */

import type { Account } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { AccountRepository } from '../../../application/ports/account-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { staleVersionError } from '../../../application/ports/repository-errors.js';
import { accountToRow, rowToAccount, type AccountRow } from '../account-mapper.js';

export class InMemoryAccountRepository implements AccountRepository {
  private readonly rows = new Map<string, AccountRow>();

  async findById(id: string): Promise<Result<Account | null, RepositoryError>> {
    const row = this.rows.get(id);
    if (!row) return ok(null);
    const r = rowToAccount(row);
    return r.isErr ? r : ok(r.value);
  }

  async findByPrincipal(principalId: string): Promise<Result<readonly Account[], RepositoryError>> {
    const out: Account[] = [];
    for (const row of this.rows.values()) {
      if (row.principal_id === principalId) {
        const r = rowToAccount(row);
        if (r.isErr) return r;
        out.push(r.value);
      }
    }
    return ok(out);
  }

  async findByPrincipalKindCurrency(
    principalId: string,
    kind: string,
    currency: string,
  ): Promise<Result<Account | null, RepositoryError>> {
    for (const row of this.rows.values()) {
      if (row.principal_id === principalId && row.kind === kind && row.currency === currency) {
        const r = rowToAccount(row);
        return r.isErr ? r : ok(r.value);
      }
    }
    return ok(null);
  }

  async save(account: Account): Promise<Result<void, WriteError>> {
    const row = accountToRow(account);
    // Enforce the (principal_id, kind, currency) uniqueness rule for inserts.
    const existing = this.rows.get(row.id);
    if (!existing) {
      for (const other of this.rows.values()) {
        if (
          other.principal_id === row.principal_id &&
          other.kind === row.kind &&
          other.currency === row.currency
        ) {
          return err({
            tag: 'RepositoryError',
            message: `duplicate account for (${row.principal_id}, ${row.kind}, ${row.currency})`,
          });
        }
      }
      this.rows.set(row.id, { ...row, version: row.version + 1 });
      return ok(undefined);
    }
    if (existing.version !== row.version) {
      return err(staleVersionError(row.id, row.version));
    }
    this.rows.set(row.id, { ...row, version: existing.version + 1 });
    return ok(undefined);
  }

  clear(): void {
    this.rows.clear();
  }
}
