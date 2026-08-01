/**
 * Runs the shared Principal + Account repository contracts against the in-memory
 * doubles. No Docker; named *.integration.test.ts so it runs under the same
 * `npm run test:integration` gate as the Postgres runners.
 */

import { runPrincipalRepositoryContract } from '../principal-repository.contract.js';
import { runAccountRepositoryContract } from '../account-repository.contract.js';
import { InMemoryPrincipalRepository } from './in-memory-principal-repository.js';
import { InMemoryAccountRepository } from './in-memory-account-repository.js';

runPrincipalRepositoryContract('InMemory', async () => {
  const repo = new InMemoryPrincipalRepository();
  return {
    repo,
    reset: async () => repo.clear(),
    dispose: async () => {},
  };
});

runAccountRepositoryContract('InMemory', async () => {
  const repo = new InMemoryAccountRepository();
  return {
    repo,
    ensurePrincipal: async () => {},
    reset: async () => repo.clear(),
    dispose: async () => {},
  };
});
