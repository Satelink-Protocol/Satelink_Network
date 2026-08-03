import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  Draw,
  DrawId,
  PrincipalId,
  AuthorizationId,
  FundingSourceId,
  AccountId,
  ConfirmationCount,
  RailTransaction,
} from '@satelink/financial-domain';
import { Money, USDT } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import type { DrawRepository } from '../../application/ports/draw-repository.js';

export interface DrawRepoHarness {
  readonly repo: DrawRepository;
  ensurePrincipal(id: string): Promise<void>;
  ensureFundingSource(id: string, principalId: string): Promise<void>;
  ensureAuthorization(id: string, principalId: string, fundingSourceId: string): Promise<void>;
  ensureAccount(id: string, principalId: string): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) {
    const errObj = r.error as any;
    console.error('must() failed:', errObj.message, errObj.cause ? errObj.cause.message || errObj.cause.toString() : '');
    throw new Error(String(r.error));
  }
  return r.value;
}

function newDraw(id: string, idemKey: string, createdAt: number = 1000): Draw {
  return must(
    Draw.create({
      id: must(DrawId.of(id)),
      principalId: must(PrincipalId.of('prn_d')),
      authorizationId: must(AuthorizationId.of('auth_d')),
      fundingSourceId: must(FundingSourceId.of('fs_d')),
      accountId: must(AccountId.of('acct_d')),
      amount: Money.fromMinorUnits(500n, USDT),
      idempotencyKey: idemKey,
      createdAt,
    }),
  );
}

export function runDrawRepositoryContract(
  name: string,
  makeHarness: () => Promise<DrawRepoHarness>,
): void {
  describe(`DrawRepository contract — ${name}`, () => {
    let h: DrawRepoHarness;
    beforeAll(async () => {
      h = await makeHarness();
    });
    beforeEach(async () => {
      await h.reset();
      await h.ensurePrincipal('prn_d');
      await h.ensureFundingSource('fs_d', 'prn_d');
      await h.ensureAuthorization('auth_d', 'prn_d', 'fs_d');
      await h.ensureAccount('acct_d', 'prn_d');
    });
    afterAll(async () => {
      await h?.dispose();
    });

    it('save then findById returns the draw with its settlement entity', async () => {
      let d = newDraw('draw_a', 'idem_a');
      d = must(d.authorize());
      d = must(d.beginSettlement(must(ConfirmationCount.of(2))));
      d = must(d.submitSettlement(must(RailTransaction.of('0xhash', 'base', 0))));

      must(await h.repo.save(d));

      const found = must(await h.repo.findById('draw_a'));
      expect(found).not.toBeNull();
      const a = found!;
      expect(a.id.value).toBe('draw_a');
      expect(a.state.value).toBe('settling');
      expect(a.version).toBe(1);
      
      const s = a.settlementView;
      expect(s).not.toBeNull();
      expect(s!.state.value).toBe('submitted');
      expect(s!.railTransaction?.txHash).toBe('0xhash');
      expect(s!.requiredConfirmations.value).toBe(2);
    });

    it('findById returns null for unknown id', async () => {
      expect(must(await h.repo.findById('nope'))).toBeNull();
    });

    it('findByIdempotencyKey returns the existing draw', async () => {
      const d = newDraw('draw_b', 'idem_b');
      must(await h.repo.save(d));

      const found = must(await h.repo.findByIdempotencyKey('idem_b'));
      expect(found).not.toBeNull();
      expect(found!.id.value).toBe('draw_b');

      expect(must(await h.repo.findByIdempotencyKey('idem_nope'))).toBeNull();
    });

    it('save enforces idempotency key uniqueness', async () => {
      const d1 = newDraw('draw_c1', 'idem_c');
      must(await h.repo.save(d1));

      const d2 = newDraw('draw_c2', 'idem_c'); // duplicate key
      const res = await h.repo.save(d2);
      expect(res.isErr).toBe(true);
      // In Postgres, this will be a constraint violation error which the repo maps to RepositoryError
    });

    it('optimistic locking rejects a concurrent stale write', async () => {
      const d = newDraw('draw_v', 'idem_v');
      must(await h.repo.save(d));

      const a = must(await h.repo.findById('draw_v'))!;
      const b = must(await h.repo.findById('draw_v'))!;

      const aMod = must(a.authorize());
      must(await h.repo.save(aMod));

      const bMod = must(b.authorize());
      const stale = await h.repo.save(bMod);
      expect(stale.isErr).toBe(true);
      if (stale.isErr) expect(stale.error.tag).toBe('StaleVersionError');

      const reloaded = must(await h.repo.findById('draw_v'))!;
      expect(reloaded.version).toBe(2);
    });

    it('findStuckSettlements returns draws in settling older than the given date', async () => {
      let d1 = newDraw('draw_s1', 'idem_s1', Date.now() - 10000); // settling
      d1 = must(d1.authorize());
      d1 = must(d1.beginSettlement(must(ConfirmationCount.of(2))));
      must(await h.repo.save(d1));

      let d2 = newDraw('draw_s2', 'idem_s2', Date.now()); // settling but newer
      d2 = must(d2.authorize());
      d2 = must(d2.beginSettlement(must(ConfirmationCount.of(2))));
      must(await h.repo.save(d2));

      let d3 = newDraw('draw_s3', 'idem_s3', Date.now() - 10000); // settled (terminal)
      d3 = must(d3.authorize());
      d3 = must(d3.beginSettlement(must(ConfirmationCount.of(0))));
      d3 = must(d3.submitSettlement(must(RailTransaction.of('0xhash', 'base', 0))));
      d3 = must(d3.addConfirmations(must(ConfirmationCount.of(0))));
      d3 = must(d3.confirmSettlement(must(ConfirmationCount.of(0)), Date.now()));
      must(await h.repo.save(d3));

      const stuck = must(await h.repo.findStuckSettlements(new Date(Date.now() - 5000)));
      expect(stuck.length).toBe(1);
      expect(stuck[0]!.id.value).toBe('draw_s1');
    });
  });
}
