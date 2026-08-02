/**
 * RailReference — an OPAQUE handle to this funding source ON its rail (e.g. a
 * facilitator id, a contract address, a deposit account). Two plain fields; the
 * domain never interprets them.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export class InvalidRailReferenceError {
  readonly tag = 'InvalidRailReferenceError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidRailReferenceError: ${this.reason}`;
  }
}

export class RailReference {
  private constructor(
    readonly refType: string,
    readonly refValue: string,
  ) {
    Object.freeze(this);
  }

  static of(refType: string, refValue: string): Result<RailReference, InvalidRailReferenceError> {
    if (typeof refType !== 'string' || refType.trim().length === 0) {
      return err(new InvalidRailReferenceError('refType must be a non-empty string'));
    }
    if (typeof refValue !== 'string' || refValue.trim().length === 0) {
      return err(new InvalidRailReferenceError('refValue must be a non-empty string'));
    }
    return ok(new RailReference(refType, refValue));
  }

  equals(other: RailReference): boolean {
    return this.refType === other.refType && this.refValue === other.refValue;
  }

  toString(): string {
    return `${this.refType}:${this.refValue}`;
  }
}
