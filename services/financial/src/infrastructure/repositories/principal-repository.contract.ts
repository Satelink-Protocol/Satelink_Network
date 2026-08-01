/**
 * Shared PrincipalRepository contract — the same spec run against every
 * implementation (Postgres and in-memory). Includes the optimistic-locking
 * behaviour: a concurrent stale write is rejected, not lost.
 *
 * Not a *.test.ts — the per-implementation runners import and invoke this.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Principal, PrincipalId, PrincipalKind, Hierarchy, ExternalRef } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import type { PrincipalRepository } from '../../application/ports/principal-repository.js';

export interface PrincipalRepoHarness {
  readonly repo: PrincipalRepository;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
function pid(v: string): PrincipalId {
  return must(PrincipalId.of(v));
}
function newPrincipal(id: string, extRef?: string, parent?: string): Principal {
  return must(
    Principal.create({
      id: pid(id),
      kind: PrincipalKind.MACHINE,
      hierarchy: parent ? Hierarchy.under(pid(parent)) : Hierarchy.root(),
      externalRef: extRef ? must(ExternalRef.of(extRef)) : undefined,
    }),
  );
}

export function runPrincipalRepositoryContract(
  name: string,
  makeHarness: () => Promise<PrincipalRepoHarness>,
): void {
  describe(`PrincipalRepository contract — ${name}`, () => {
    let h: PrincipalRepoHarness;
    beforeAll(async () => {
      h = await makeHarness();
    });
    beforeEach(async () => {
      await h.reset();
    });
    afterAll(async () => {
      await h?.dispose();
    });

    it('save (insert) then findById returns the principal at version 1', async () => {
      expect((await h.repo.save(newPrincipal('prn_a', 'ext_a'))).isOk).toBe(true);
      const found = must(await h.repo.findById('prn_a'));
      expect(found).not.toBeNull();
      expect(found!.id.value).toBe('prn_a');
      expect(found!.version).toBe(1);
    });

    it('findById returns null for an unknown id', async () => {
      expect(must(await h.repo.findById('nope'))).toBeNull();
    });

    it('findByExternalRef locates the principal', async () => {
      await h.repo.save(newPrincipal('prn_b', 'wallet_0xabc'));
      const found = must(await h.repo.findByExternalRef('wallet_0xabc'));
      expect(found?.id.value).toBe('prn_b');
      expect(must(await h.repo.findByExternalRef('missing'))).toBeNull();
    });

    it('findChildren returns principals under a parent', async () => {
      await h.repo.save(newPrincipal('prn_parent', 'ext_parent'));
      await h.repo.save(newPrincipal('prn_child1', 'ext_c1', 'prn_parent'));
      await h.repo.save(newPrincipal('prn_child2', 'ext_c2', 'prn_parent'));
      const kids = must(await h.repo.findChildren('prn_parent'));
      expect(kids.map((k) => k.id.value).sort()).toEqual(['prn_child1', 'prn_child2']);
    });

    it('optimistic locking: a concurrent stale write is rejected', async () => {
      await h.repo.save(newPrincipal('prn_v', 'ext_v'));
      const a = must(await h.repo.findById('prn_v'))!; // version 1
      const b = must(await h.repo.findById('prn_v'))!; // version 1

      // First writer wins.
      const firstWrite = await h.repo.save(must(a.activate()));
      expect(firstWrite.isOk).toBe(true);

      // Second writer holds a stale version -> rejected.
      const secondWrite = await h.repo.save(must(b.pause()));
      expect(secondWrite.isErr).toBe(true);
      if (secondWrite.isErr) expect(secondWrite.error.tag).toBe('StaleVersionError');

      // The DB reflects the first writer's change.
      const reloaded = must(await h.repo.findById('prn_v'))!;
      expect(reloaded.state.value).toBe('active');
      expect(reloaded.version).toBe(2);
    });
  });
}
