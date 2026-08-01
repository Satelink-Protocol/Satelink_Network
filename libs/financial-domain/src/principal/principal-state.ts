/**
 * PrincipalState — lifecycle state.
 *
 *   created -> active <-> paused -> suspended -> closed(terminal)
 *
 * plus the safety rule (#9): pause is available from ANY non-terminal state and
 * is never permission-gated. Transition legality is enforced by the Principal
 * aggregate; this VO just names the states and knows which is terminal.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type PrincipalStateValue = 'created' | 'active' | 'paused' | 'suspended' | 'closed';

const VALUES: readonly PrincipalStateValue[] = [
  'created',
  'active',
  'paused',
  'suspended',
  'closed',
];

export class InvalidPrincipalStateError {
  readonly tag = 'InvalidPrincipalStateError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidPrincipalStateError: "${this.value}" is not a valid principal state`;
  }
}

export class PrincipalState {
  private constructor(readonly value: PrincipalStateValue) {
    Object.freeze(this);
  }

  static readonly CREATED: PrincipalState = new PrincipalState('created');
  static readonly ACTIVE: PrincipalState = new PrincipalState('active');
  static readonly PAUSED: PrincipalState = new PrincipalState('paused');
  static readonly SUSPENDED: PrincipalState = new PrincipalState('suspended');
  static readonly CLOSED: PrincipalState = new PrincipalState('closed');

  static of(raw: string): Result<PrincipalState, InvalidPrincipalStateError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new PrincipalState(raw as PrincipalStateValue));
    }
    return err(new InvalidPrincipalStateError(raw));
  }

  isTerminal(): boolean {
    return this.value === 'closed';
  }

  equals(other: PrincipalState): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
