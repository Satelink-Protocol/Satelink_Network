/**
 * Runs the shared FundingSource + Authorization repository contracts against the
 * in-memory doubles. No Docker; runs under the test:integration gate.
 */

import { runFundingSourceRepositoryContract } from '../funding-source-repository.contract.js';
import { runAuthorizationRepositoryContract } from '../authorization-repository.contract.js';
import { InMemoryFundingSourceRepository } from './in-memory-funding-source-repository.js';
import { InMemoryAuthorizationRepository } from './in-memory-authorization-repository.js';

runFundingSourceRepositoryContract('InMemory', async () => {
  const repo = new InMemoryFundingSourceRepository();
  return {
    repo,
    ensurePrincipal: async () => {},
    reset: async () => repo.clear(),
    dispose: async () => {},
  };
});

runAuthorizationRepositoryContract('InMemory', async () => {
  const repo = new InMemoryAuthorizationRepository();
  return {
    repo,
    ensurePrincipal: async () => {},
    ensureFundingSource: async () => {},
    reset: async () => repo.clear(),
    dispose: async () => {},
  };
});
