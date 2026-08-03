/**
 * DrawState — the Draw aggregate state machine.
 *
 * requested → authorized → settling → settled (terminal)
 * requested → rejected (terminal)
 * settling  → failed → retrying → settling
 * retrying  → failed_permanent (terminal)
 *
 * Terminal states: settled, rejected, failed_permanent.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type DrawStateValue =
  | 'requested'
  | 'authorized'
  | 'settling'
  | 'settled'
  | 'rejected'
  | 'failed'
  | 'retrying'
  | 'failed_permanent';

const VALUES: readonly DrawStateValue[] = [
  'requested',
  'authorized',
  'settling',
  'settled',
  'rejected',
  'failed',
  'retrying',
  'failed_permanent',
];

const TERMINALS: ReadonlySet<DrawStateValue> = new Set([
  'settled',
  'rejected',
  'failed_permanent',
]);

export class InvalidDrawStateError {
  readonly tag = 'InvalidDrawStateError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidDrawStateError: "${this.value}" is not a valid draw state`;
  }
}

export class DrawState {
  private constructor(readonly value: DrawStateValue) {
    Object.freeze(this);
  }

  static readonly REQUESTED: DrawState = new DrawState('requested');
  static readonly AUTHORIZED: DrawState = new DrawState('authorized');
  static readonly SETTLING: DrawState = new DrawState('settling');
  static readonly SETTLED: DrawState = new DrawState('settled');
  static readonly REJECTED: DrawState = new DrawState('rejected');
  static readonly FAILED: DrawState = new DrawState('failed');
  static readonly RETRYING: DrawState = new DrawState('retrying');
  static readonly FAILED_PERMANENT: DrawState = new DrawState('failed_permanent');

  static of(raw: string): Result<DrawState, InvalidDrawStateError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new DrawState(raw as DrawStateValue));
    }
    return err(new InvalidDrawStateError(raw));
  }

  isTerminal(): boolean {
    return TERMINALS.has(this.value);
  }

  equals(other: DrawState): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
