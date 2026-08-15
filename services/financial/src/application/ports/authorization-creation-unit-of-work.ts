/**
 * AuthorizationCreationUnitOfWork — commits a NEW authorization and everything
 * it needs (principal, funding source, capacity account, the single settlement
 * nonce) in ONE database transaction. Either all four rows exist afterward or
 * none are written.
 *
 * Idempotent on the authorization id (derived from the EIP-3009 nonce): a
 * re-submitted envelope creates nothing new and reports created=false. This
 * mirrors the M6 PostgresUnitOfWork.commitDrawAndLedger single-transaction
 * pattern for the money path.
 */

import type { Account, Authorization, FundingSource, Principal } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import type { WriteError } from './repository-errors.js';

export interface AuthorizationCreationInput {
  /** Principal that owns the authorization. `principalIsNew` decides whether it
   * is inserted or assumed to already exist (resolved by the command). */
  readonly principal: Principal;
  readonly principalIsNew: boolean;
  readonly fundingSource: FundingSource;
  readonly authorization: Authorization;
  readonly account: Account;
}

export interface AuthorizationCreationOutcome {
  /** true iff the authorization row was newly inserted by this call. */
  readonly created: boolean;
  readonly principalId: string;
  readonly fundingSourceId: string;
  readonly authorizationId: string;
  readonly accountId: string;
}

export interface AuthorizationCreationUnitOfWork {
  commit(
    input: AuthorizationCreationInput,
  ): Promise<Result<AuthorizationCreationOutcome, WriteError>>;
}
