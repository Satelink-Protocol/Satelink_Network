import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Draw } from './draw.js';
import { DrawId } from './draw-id.js';
import { PrincipalId } from '../shared/principal-id.js';
import { AuthorizationId } from '../shared/authorization-id.js';
import { FundingSourceId } from '../shared/funding-source-id.js';
import { AccountId } from '../shared/account-id.js';
import { RejectReason } from './reject-reason.js';
import { RailTransaction } from './rail-transaction.js';
import { ConfirmationCount } from './confirmation-count.js';
import { Money, USDT } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}

function newDraw(): Draw {
  return must(
    Draw.create({
      id: must(DrawId.of('draw_1')),
      principalId: must(PrincipalId.of('prn_1')),
      authorizationId: must(AuthorizationId.of('auth_1')),
      fundingSourceId: must(FundingSourceId.of('fs_1')),
      accountId: must(AccountId.of('acct_1')),
      amount: Money.fromMinorUnits(100n, USDT),
      idempotencyKey: 'idem_1',
      createdAt: 1000,
    })
  );
}

const reqConfs = must(ConfirmationCount.of(2));
const railTx = must(RailTransaction.of('0x123', 'base', 0));

describe('Draw aggregate', () => {
  describe('state machine', () => {
    it('creates in requested state', () => {
      const d = newDraw();
      expect(d.state.value).toBe('requested');
      expect(d.settlementView).toBeNull();
    });

    it('requested -> authorized -> settling -> settled', () => {
      let d = newDraw();
      d = must(d.authorize());
      expect(d.state.value).toBe('authorized');

      d = must(d.beginSettlement(reqConfs));
      expect(d.state.value).toBe('settling');
      expect(d.settlementView?.state.value).toBe('pending');
      expect(d.settlementView?.requiredConfirmations.value).toBe(2);

      d = must(d.submitSettlement(railTx));
      expect(d.settlementView?.state.value).toBe('submitted');
      expect(d.settlementView?.railTransaction?.txHash).toBe('0x123');
      expect(d.settlementView?.attemptCount.value).toBe(1);

      d = must(d.addConfirmations(must(ConfirmationCount.of(1))));
      expect(d.settlementView?.state.value).toBe('confirming');
      expect(d.settlementView?.confirmations.value).toBe(1);

      // Confirm with exactly required confirmations
      d = must(d.confirmSettlement(must(ConfirmationCount.of(2)), 2000));
      expect(d.state.value).toBe('settled');
      expect(d.settlementView?.state.value).toBe('confirmed');
      expect(d.settlementView?.confirmations.value).toBe(2);
      expect(d.settlementView?.confirmedAt).toBe(2000);
    });

    it('requested -> rejected', () => {
      let d = newDraw();
      d = must(d.reject(RejectReason.INSUFFICIENT_CAPACITY));
      expect(d.state.value).toBe('rejected');
      expect(d.rejectReason?.value).toBe('insufficient_capacity');
    });

    it('settling -> failed -> retrying -> settling -> settled', () => {
      let d = newDraw();
      d = must(d.authorize());
      d = must(d.beginSettlement(reqConfs));
      d = must(d.submitSettlement(railTx));

      d = must(d.revertSettlement());
      expect(d.state.value).toBe('failed');
      expect(d.settlementView?.state.value).toBe('reverted');

      d = must(d.retryDraw());
      expect(d.state.value).toBe('retrying');

      d = must(d.retrySettlementStep());
      expect(d.state.value).toBe('settling');
      expect(d.settlementView?.state.value).toBe('retrying_settlement');

      // from retrying_settlement, we can submit again, or confirm if we just needed to wait longer
      // Let's assume we confirm directly from retrying_settlement (e.g., tx wasn't actually reverted on chain)
      d = must(d.confirmSettlement(reqConfs, 3000));
      expect(d.state.value).toBe('settled');
    });

    it('retrying -> failed_permanent', () => {
      let d = newDraw();
      d = must(d.authorize());
      d = must(d.beginSettlement(reqConfs));
      d = must(d.submitSettlement(railTx));
      d = must(d.revertSettlement());
      d = must(d.retryDraw());

      d = must(d.failPermanent());
      expect(d.state.value).toBe('failed_permanent');
      expect(d.settlementView?.state.value).toBe('failed_permanent_settlement');
    });

    it('rejects confirmSettlement if confirmations < requiredConfirmations', () => {
      let d = newDraw();
      d = must(d.authorize());
      d = must(d.beginSettlement(reqConfs)); // requires 2
      d = must(d.submitSettlement(railTx));
      d = must(d.addConfirmations(must(ConfirmationCount.of(1))));

      const result = d.confirmSettlement(must(ConfirmationCount.of(1)), 2000);
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.tag).toBe('InsufficientConfirmationsError');
      }
    });

    it('rejects illegal transitions', () => {
      const d = newDraw();
      expect(d.beginSettlement(reqConfs).isErr).toBe(true);
      expect(d.submitSettlement(railTx).isErr).toBe(true);
      expect(d.confirmSettlement(reqConfs, 2000).isErr).toBe(true);
      expect(d.revertSettlement().isErr).toBe(true);
    });
  });
});
