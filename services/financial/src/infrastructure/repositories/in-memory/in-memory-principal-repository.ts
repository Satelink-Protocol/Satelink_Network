/**
 * InMemoryPrincipalRepository — in-memory double. Stores the persisted row shape
 * (not the aggregate) so version/optimistic-locking behaviour mirrors Postgres
 * exactly, keeping the shared contract honest.
 */

import type { Principal } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { PrincipalRepository } from '../../../application/ports/principal-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { staleVersionError } from '../../../application/ports/repository-errors.js';
import { principalToRow, rowToPrincipal, type PrincipalRow } from '../principal-mapper.js';

export class InMemoryPrincipalRepository implements PrincipalRepository {
  private readonly rows = new Map<string, PrincipalRow>();

  async findById(id: string): Promise<Result<Principal | null, RepositoryError>> {
    const row = this.rows.get(id);
    if (!row) return ok(null);
    const r = rowToPrincipal(row);
    return r.isErr ? r : ok(r.value);
  }

  async findByExternalRef(externalRef: string): Promise<Result<Principal | null, RepositoryError>> {
    for (const row of this.rows.values()) {
      if (row.external_ref === externalRef) {
        const r = rowToPrincipal(row);
        return r.isErr ? r : ok(r.value);
      }
    }
    return ok(null);
  }

  async findChildren(parentId: string): Promise<Result<readonly Principal[], RepositoryError>> {
    const out: Principal[] = [];
    for (const row of this.rows.values()) {
      if (row.parent_id === parentId) {
        const r = rowToPrincipal(row);
        if (r.isErr) return r;
        out.push(r.value);
      }
    }
    return ok(out);
  }

  async save(principal: Principal): Promise<Result<void, WriteError>> {
    const row = principalToRow(principal);
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
