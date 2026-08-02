/**
 * FundingSourceRepository — persistence port for the FundingSource aggregate.
 * save() uses optimistic locking on the aggregate's version.
 */

import type { FundingSource } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import type { RepositoryError, WriteError } from './repository-errors.js';

export interface FundingSourceRepository {
  findById(id: string): Promise<Result<FundingSource | null, RepositoryError>>;
  findByPrincipal(principalId: string): Promise<Result<readonly FundingSource[], RepositoryError>>;
  save(fundingSource: FundingSource): Promise<Result<void, WriteError>>;
}
