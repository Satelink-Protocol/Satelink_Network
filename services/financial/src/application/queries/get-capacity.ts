/**
 * GetCapacity — READ-ONLY query. Aggregates a principal's active authorizations
 * into {cap, consumed, available, noncesRemaining}. It ENFORCES NOTHING and
 * nothing consumes its result for a decision (M5 is read-only). Amounts are
 * exact decimal strings derived from Money (no floats).
 */

import { Money } from '@satelink/kernel';
import type { AuthorizationRepository } from '../ports/authorization-repository.js';
import type { RepositoryError } from '../ports/repository-errors.js';
import { repositoryError } from '../ports/repository-errors.js';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export interface CapacityView {
  readonly principalId: string;
  readonly currency: string | null;
  readonly cap: string;
  readonly consumed: string;
  readonly available: string;
  readonly noncesRemaining: number;
  readonly authorizationCount: number;
}

export async function getCapacity(
  authorizations: AuthorizationRepository,
  principalId: string,
): Promise<Result<CapacityView, RepositoryError>> {
  const res = await authorizations.findByPrincipal(principalId);
  if (res.isErr) return res;

  const active = res.value.filter((a) => a.state.value === 'active');
  if (active.length === 0) {
    return ok({
      principalId,
      currency: null,
      cap: '0',
      consumed: '0',
      available: '0',
      noncesRemaining: 0,
      authorizationCount: 0,
    });
  }

  const currency = active[0]!.currency;
  let cap = Money.fromMinorUnits(0n, currency);
  let consumed = Money.fromMinorUnits(0n, currency);
  let noncesRemaining = 0;

  for (const a of active) {
    if (!a.currency.equals(currency)) {
      return err(repositoryError(`principal ${principalId} has authorizations in mixed currencies`));
    }
    const capSum = cap.add(a.cap.money);
    const consumedSum = consumed.add(a.consumed.money);
    if (capSum.isErr || consumedSum.isErr) {
      return err(repositoryError('currency mismatch while summing capacity'));
    }
    cap = capSum.value;
    consumed = consumedSum.value;
    noncesRemaining += a.noncesRemaining();
  }

  const available = cap.subtract(consumed);
  if (available.isErr) {
    return err(repositoryError('currency mismatch computing available'));
  }

  return ok({
    principalId,
    currency: currency.code,
    cap: cap.toDecimalString(),
    consumed: consumed.toDecimalString(),
    available: available.value.toDecimalString(),
    noncesRemaining,
    authorizationCount: active.length,
  });
}
