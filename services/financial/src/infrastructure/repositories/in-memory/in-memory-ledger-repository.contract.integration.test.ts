/**
 * Runs the shared LedgerRepository contract against the in-memory double.
 *
 * No Docker required, but named *.integration.test.ts so it runs under the same
 * `npm run test:integration` gate as the Postgres runner — the two run the
 * identical contract, which is the point.
 */

import { runLedgerRepositoryContract } from '../ledger-repository.contract.js';
import { InMemoryLedgerRepository } from './in-memory-ledger-repository.js';

runLedgerRepositoryContract('InMemory', async () => {
  const repo = new InMemoryLedgerRepository();
  return {
    repo,
    ensureAccount: async () => {
      /* no FK in memory */
    },
    reset: async () => {
      repo.clear();
    },
    dispose: async () => {
      /* nothing to tear down */
    },
  };
});
