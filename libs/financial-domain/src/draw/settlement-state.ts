/**
 * SettlementState — the Settlement entity state machine.
 *
 * pending → submitted → confirming → confirmed (terminal)
 * submitted → reverted → retrying_settlement → {confirmed | failed_permanent_settlement}
 *
 * Terminal: confirmed, failed_permanent_settlement.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type SettlementStateValue =
  | 'pending'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'reverted'
  | 'retrying_settlement'
  | 'failed_permanent_settlement';

const VALUES: readonly SettlementStateValue[] = [
  'pending',
  'submitted',
  'confirming',
  'confirmed',
  'reverted',
  'retrying_settlement',
  'failed_permanent_settlement',
];

const TERMINALS: ReadonlySet<SettlementStateValue> = new Set([
  'confirmed',
  'failed_permanent_settlement',
]);

export class InvalidSettlementStateError {
  readonly tag = 'InvalidSettlementStateError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidSettlementStateError: "${this.value}" is not a valid settlement state`;
  }
}

export class SettlementState {
  private constructor(readonly value: SettlementStateValue) {
    Object.freeze(this);
  }

  static readonly PENDING: SettlementState = new SettlementState('pending');
  static readonly SUBMITTED: SettlementState = new SettlementState('submitted');
  static readonly CONFIRMING: SettlementState = new SettlementState('confirming');
  static readonly CONFIRMED: SettlementState = new SettlementState('confirmed');
  static readonly REVERTED: SettlementState = new SettlementState('reverted');
  static readonly RETRYING_SETTLEMENT: SettlementState = new SettlementState('retrying_settlement');
  static readonly FAILED_PERMANENT_SETTLEMENT: SettlementState = new SettlementState('failed_permanent_settlement');

  static of(raw: string): Result<SettlementState, InvalidSettlementStateError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new SettlementState(raw as SettlementStateValue));
    }
    return err(new InvalidSettlementStateError(raw));
  }

  isTerminal(): boolean {
    return TERMINALS.has(this.value);
  }

  equals(other: SettlementState): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
