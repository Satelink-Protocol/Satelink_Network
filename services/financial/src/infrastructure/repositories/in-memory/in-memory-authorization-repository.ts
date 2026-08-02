/**
 * InMemoryAuthorizationRepository — in-memory double. Stores the root row and
 * its full nonce set together; nonces are never addressable on their own.
 * Optimistic locking on the root version.
 */

import type { Authorization } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { AuthorizationRepository } from '../../../application/ports/authorization-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { staleVersionError } from '../../../application/ports/repository-errors.js';
import {
  authorizationToRow,
  noncesToRows,
  rowsToAuthorization,
  type AuthorizationRow,
  type NonceRow,
} from '../authorization-mapper.js';

interface Stored {
  row: AuthorizationRow;
  nonces: NonceRow[];
}

export class InMemoryAuthorizationRepository implements AuthorizationRepository {
  private readonly store = new Map<string, Stored>();

  async findById(id: string): Promise<Result<Authorization | null, RepositoryError>> {
    const s = this.store.get(id);
    if (!s) return ok(null);
    const r = rowsToAuthorization(s.row, s.nonces);
    return r.isErr ? r : ok(r.value);
  }

  async findByPrincipal(principalId: string): Promise<Result<readonly Authorization[], RepositoryError>> {
    const out: Authorization[] = [];
    for (const s of this.store.values()) {
      if (s.row.principal_id === principalId) {
        const r = rowsToAuthorization(s.row, s.nonces);
        if (r.isErr) return r;
        out.push(r.value);
      }
    }
    return ok(out);
  }

  async save(authorization: Authorization): Promise<Result<void, WriteError>> {
    const row = authorizationToRow(authorization);
    const nonces = noncesToRows(authorization);
    const existing = this.store.get(row.id);
    if (!existing) {
      this.store.set(row.id, { row: { ...row, version: row.version + 1 }, nonces });
      return ok(undefined);
    }
    if (existing.row.version !== row.version) {
      return err(staleVersionError(row.id, row.version));
    }
    this.store.set(row.id, { row: { ...row, version: existing.row.version + 1 }, nonces });
    return ok(undefined);
  }

  clear(): void {
    this.store.clear();
  }
}
