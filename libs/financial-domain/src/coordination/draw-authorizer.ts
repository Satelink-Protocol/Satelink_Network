/**
 * DrawAuthorizer — pure coordination function that spans aggregates.
 *
 * Lives in coordination/ because it references Authorization, FundingSource,
 * and the Draw amount — cross-aggregate logic (#7, CLAUDE.md).
 *
 * Grants and policies are M10/M11 — accepted as optional params so they slot
 * in without changing the signature when built.
 *
 * (authorization, grants?, policies?, amount) → Authorized | Rejected(reason)
 */

import type { Authorization } from '../authorization/authorization.js';
import type { FundingSource } from '../funding-source/funding-source.js';
import type { Money, Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { RejectReason } from '../draw/reject-reason.js';

/** Placeholder — M10. */
export interface Grant {
  readonly placeholder: true;
}

/** Placeholder — M11. */
export interface Policy {
  readonly placeholder: true;
}

export type AuthorizeDrawResult = Result<'authorized', RejectReason>;

/**
 * Decide whether a draw of `amount` against `authorization` on `fundingSource`
 * is permitted. Pure function — no I/O.
 *
 * @param authorization  The authorization to draw against
 * @param fundingSource  The funding source backing the authorization
 * @param amount         The amount to draw
 * @param grants         Unused until M10 — waterfall grants
 * @param policies       Unused until M11 — budget policies
 */
export function authorizeDrawRequest(
  authorization: Authorization,
  fundingSource: FundingSource,
  amount: Money,
  _grants?: readonly Grant[],
  _policies?: readonly Policy[],
): AuthorizeDrawResult {
  // Funding source must be active
  if (fundingSource.state.value !== 'active') {
    return err(RejectReason.FUNDING_SOURCE_INACTIVE);
  }

  // Authorization must not be revoked
  if (authorization.state.isTerminal()) {
    return err(RejectReason.AUTHORIZATION_REVOKED);
  }

  // Currency must match
  if (!amount.currency.equals(authorization.currency)) {
    return err(RejectReason.CURRENCY_MISMATCH);
  }

  // Amount must not exceed available capacity (cap - consumed)
  const available = authorization.available();
  const exceeds = amount.greaterThan(available);
  if (exceeds.isErr) {
    return err(RejectReason.CURRENCY_MISMATCH);
  }
  if (exceeds.value) {
    return err(RejectReason.CAP_EXCEEDED);
  }

  // Amount must be positive
  if (!amount.isPositive()) {
    return err(RejectReason.INSUFFICIENT_CAPACITY);
  }

  return ok('authorized' as const);
}
