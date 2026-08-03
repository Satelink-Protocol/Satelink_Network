/**
 * RejectReason — machine-readable, closed enum. NEVER free text.
 * Used when a Draw is rejected at authorization time.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type RejectReasonValue =
  | 'insufficient_capacity'
  | 'authorization_revoked'
  | 'currency_mismatch'
  | 'cap_exceeded'
  | 'funding_source_inactive'
  | 'policy_denied'
  | 'duplicate_key';

const VALUES: readonly RejectReasonValue[] = [
  'insufficient_capacity',
  'authorization_revoked',
  'currency_mismatch',
  'cap_exceeded',
  'funding_source_inactive',
  'policy_denied',
  'duplicate_key',
];

export class InvalidRejectReasonError {
  readonly tag = 'InvalidRejectReasonError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidRejectReasonError: "${this.value}" is not a valid reject reason`;
  }
}

export class RejectReason {
  private constructor(readonly value: RejectReasonValue) {
    Object.freeze(this);
  }

  static readonly INSUFFICIENT_CAPACITY: RejectReason = new RejectReason('insufficient_capacity');
  static readonly AUTHORIZATION_REVOKED: RejectReason = new RejectReason('authorization_revoked');
  static readonly CURRENCY_MISMATCH: RejectReason = new RejectReason('currency_mismatch');
  static readonly CAP_EXCEEDED: RejectReason = new RejectReason('cap_exceeded');
  static readonly FUNDING_SOURCE_INACTIVE: RejectReason = new RejectReason('funding_source_inactive');
  static readonly POLICY_DENIED: RejectReason = new RejectReason('policy_denied');
  static readonly DUPLICATE_KEY: RejectReason = new RejectReason('duplicate_key');

  static of(raw: string): Result<RejectReason, InvalidRejectReasonError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new RejectReason(raw as RejectReasonValue));
    }
    return err(new InvalidRejectReasonError(raw));
  }

  equals(other: RejectReason): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
