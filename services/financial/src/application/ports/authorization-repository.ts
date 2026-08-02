/**
 * AuthorizationRepository — persistence port for the Authorization aggregate.
 *
 * The FULL nonce set is ALWAYS loaded with the root; nonces are never queried
 * independently (they are entities inside the aggregate). save() persists the
 * root and its nonces together, with optimistic locking on the root's version.
 */

import type { Authorization } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import type { RepositoryError, WriteError } from './repository-errors.js';

export interface AuthorizationRepository {
  /** Loads the authorization WITH its full nonce set. */
  findById(id: string): Promise<Result<Authorization | null, RepositoryError>>;
  /** Each authorization is returned with its full nonce set. */
  findByPrincipal(principalId: string): Promise<Result<readonly Authorization[], RepositoryError>>;
  /** Persists the root + all nonces atomically; optimistic lock on version. */
  save(authorization: Authorization): Promise<Result<void, WriteError>>;
}
