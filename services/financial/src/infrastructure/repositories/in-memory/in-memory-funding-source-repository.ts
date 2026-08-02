/**
 * InMemoryFundingSourceRepository — in-memory double mirroring Postgres
 * optimistic-locking semantics.
 */

import type { FundingSource } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { FundingSourceRepository } from '../../../application/ports/funding-source-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { staleVersionError } from '../../../application/ports/repository-errors.js';
import {
  fundingSourceToRow,
  rowToFundingSource,
  type FundingSourceRow,
} from '../funding-source-mapper.js';

export class InMemoryFundingSourceRepository implements FundingSourceRepository {
  private readonly rows = new Map<string, FundingSourceRow>();

  async findById(id: string): Promise<Result<FundingSource | null, RepositoryError>> {
    const row = this.rows.get(id);
    if (!row) return ok(null);
    const r = rowToFundingSource(row);
    return r.isErr ? r : ok(r.value);
  }

  async findByPrincipal(principalId: string): Promise<Result<readonly FundingSource[], RepositoryError>> {
    const out: FundingSource[] = [];
    for (const row of this.rows.values()) {
      if (row.principal_id === principalId) {
        const r = rowToFundingSource(row);
        if (r.isErr) return r;
        out.push(r.value);
      }
    }
    return ok(out);
  }

  async save(fundingSource: FundingSource): Promise<Result<void, WriteError>> {
    const row = fundingSourceToRow(fundingSource);
    const existing = this.rows.get(row.id);
    if (!existing) {
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
