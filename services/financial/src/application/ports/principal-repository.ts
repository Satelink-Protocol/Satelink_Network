/**
 * PrincipalRepository — persistence port for the Principal aggregate.
 * Declared in application, implemented in infrastructure (dependency inversion).
 *
 * `save` uses optimistic locking on the aggregate's `version`: a concurrent
 * stale write is rejected with StaleVersionError rather than lost.
 */

import type { Principal } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import type { RepositoryError, WriteError } from './repository-errors.js';

export interface PrincipalRepository {
  findById(id: string): Promise<Result<Principal | null, RepositoryError>>;
  findByExternalRef(externalRef: string): Promise<Result<Principal | null, RepositoryError>>;
  findChildren(parentId: string): Promise<Result<readonly Principal[], RepositoryError>>;
  /** Insert (new) or compare-and-set update (existing, by version). */
  save(principal: Principal): Promise<Result<void, WriteError>>;
}
