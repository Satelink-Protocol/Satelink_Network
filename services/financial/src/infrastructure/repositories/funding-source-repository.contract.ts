/**
 * Shared FundingSourceRepository contract — run against Postgres and in-memory.
 * Covers find*, save (insert -> version 1), and optimistic locking.
 *
 * The harness supplies ensurePrincipal() so the Postgres FK (funding_sources ->
 * principals) is satisfied; in-memory makes it a no-op.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  FundingSource,
  FundingSourceId,
  PrincipalId,
  RailId,
  RailReference,
  FundingMode,
  Capabilities,
} from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import type { FundingSourceRepository } from '../../application/ports/funding-source-repository.js';

export interface FundingSourceRepoHarness {
  readonly repo: FundingSourceRepository;
  ensurePrincipal(id: string): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
function newFundingSource(id: string, principalId: string): FundingSource {
  return must(
    FundingSource.create({
      id: must(FundingSourceId.of(id)),
      principalId: must(PrincipalId.of(principalId)),
      railId: must(RailId.of('x402-base-usdc')),
      railReference: must(RailReference.of('facilitator', '0xabc')),
      mode: FundingMode.AUTHORIZATION,
      capabilities: must(
        Capabilities.of({
          supportsRecurring: true,
          supportsEscrow: false,
          supportsRefund: false,
          agentCompatible: true,
          settlementLatency: 'instant',
          custodial: false,
        }),
      ),
    }),
  );
}

export function runFundingSourceRepositoryContract(
  name: string,
  makeHarness: () => Promise<FundingSourceRepoHarness>,
): void {
  describe(`FundingSourceRepository contract — ${name}`, () => {
    let h: FundingSourceRepoHarness;
    beforeAll(async () => {
      h = await makeHarness();
    });
    beforeEach(async () => {
      await h.reset();
      await h.ensurePrincipal('prn_owner');
    });
    afterAll(async () => {
      await h?.dispose();
    });

    it('save then findById returns the source at version 1', async () => {
      expect((await h.repo.save(newFundingSource('fs_a', 'prn_owner'))).isOk).toBe(true);
      const found = must(await h.repo.findById('fs_a'));
      expect(found?.id.value).toBe('fs_a');
      expect(found?.version).toBe(1);
      expect(found?.state.value).toBe('registered');
      expect(found?.capabilities.agentCompatible).toBe(true);
    });

    it('findById returns null for unknown id', async () => {
      expect(must(await h.repo.findById('nope'))).toBeNull();
    });

    it('findByPrincipal returns the sources', async () => {
      await h.repo.save(newFundingSource('fs_a', 'prn_owner'));
      const list = must(await h.repo.findByPrincipal('prn_owner'));
      expect(list.map((f) => f.id.value)).toEqual(['fs_a']);
    });

    it('optimistic locking: a concurrent stale write is rejected', async () => {
      await h.repo.save(newFundingSource('fs_v', 'prn_owner'));
      const a = must(await h.repo.findById('fs_v'))!;
      const b = must(await h.repo.findById('fs_v'))!;

      expect((await h.repo.save(must(a.verify()))).isOk).toBe(true);
      const stale = await h.repo.save(must(b.verify()));
      expect(stale.isErr).toBe(true);
      if (stale.isErr) expect(stale.error.tag).toBe('StaleVersionError');

      const reloaded = must(await h.repo.findById('fs_v'))!;
      expect(reloaded.state.value).toBe('verified');
      expect(reloaded.version).toBe(2);
    });
  });
}
