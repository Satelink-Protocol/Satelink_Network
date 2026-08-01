/**
 * SourceReference — an OPAQUE pointer to the domain event that caused a ledger
 * transaction.
 *
 * DELIBERATELY two plain strings: { refType, refId }. It never imports a typed
 * DrawId, ChargeId, or any other aggregate identifier — doing so would couple
 * the ledger to those aggregates and create an import cycle (see the
 * `no-aggregate-to-aggregate` rule in .dependency-cruiser.cjs). The ledger only
 * needs to record "what pointed at me", not to understand it.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export class InvalidSourceReferenceError {
  readonly tag = 'InvalidSourceReferenceError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidSourceReferenceError: ${this.reason}`;
  }
}

export class SourceReference {
  private constructor(
    readonly refType: string,
    readonly refId: string,
  ) {
    Object.freeze(this);
  }

  static of(
    refType: string,
    refId: string,
  ): Result<SourceReference, InvalidSourceReferenceError> {
    if (typeof refType !== 'string' || refType.trim().length === 0) {
      return err(new InvalidSourceReferenceError('refType must be a non-empty string'));
    }
    if (typeof refId !== 'string' || refId.trim().length === 0) {
      return err(new InvalidSourceReferenceError('refId must be a non-empty string'));
    }
    return ok(new SourceReference(refType, refId));
  }

  equals(other: SourceReference): boolean {
    return this.refType === other.refType && this.refId === other.refId;
  }

  toString(): string {
    return `${this.refType}:${this.refId}`;
  }
}
