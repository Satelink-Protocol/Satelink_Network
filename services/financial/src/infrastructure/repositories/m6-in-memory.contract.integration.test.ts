import { runDrawRepositoryContract } from './draw-repository.contract.js';
import type { DrawRepoHarness } from './draw-repository.contract.js';
import { InMemoryDrawRepository } from './in-memory/in-memory-draw-repository.js';

class InMemoryDrawRepoHarness implements DrawRepoHarness {
  readonly repo = new InMemoryDrawRepository();

  async ensurePrincipal(_id: string): Promise<void> {}
  async ensureFundingSource(_id: string, _principalId: string): Promise<void> {}
  async ensureAuthorization(_id: string, _principalId: string, _fundingSourceId: string): Promise<void> {}
  async ensureAccount(_id: string, _principalId: string): Promise<void> {}

  async reset(): Promise<void> {
    (this.repo as any).store.clear();
  }
  async dispose(): Promise<void> {}
}

runDrawRepositoryContract('in-memory', async () => new InMemoryDrawRepoHarness());
