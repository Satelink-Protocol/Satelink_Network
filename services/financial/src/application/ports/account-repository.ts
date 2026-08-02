/**
 * AccountRepository — persistence port for the Account aggregate.
 *
 * `findByPrincipalKindCurrency` backs the (principal_id, kind, currency)
 * uniqueness rule; `save` uses optimistic locking on `version`.
 */

import type { Account } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import type { RepositoryError, WriteError } from './repository-errors.js';

export interface AccountRepository {
  findById(id: string): Promise<Result<Account | null, RepositoryError>>;
  findByPrincipal(principalId: string): Promise<Result<readonly Account[], RepositoryError>>;
  findByPrincipalKindCurrency(
    principalId: string,
    kind: string,
    currency: string,
  ): Promise<Result<Account | null, RepositoryError>>;
  /** Insert (new) or compare-and-set update (existing, by version). */
  save(account: Account): Promise<Result<void, WriteError>>;
}
