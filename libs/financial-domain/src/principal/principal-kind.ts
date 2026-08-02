/**
 * PrincipalKind — the taxonomy of principals. Closed set matching the CHECK
 * constraint on principals.kind (001).
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type PrincipalKindValue =
  | 'human'
  | 'agent'
  | 'machine'
  | 'org'
  | 'project'
  | 'platform';

const VALUES: readonly PrincipalKindValue[] = [
  'human',
  'agent',
  'machine',
  'org',
  'project',
  'platform',
];

export class InvalidPrincipalKindError {
  readonly tag = 'InvalidPrincipalKindError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidPrincipalKindError: "${this.value}" is not a valid principal kind`;
  }
}

export class PrincipalKind {
  private constructor(readonly value: PrincipalKindValue) {
    Object.freeze(this);
  }

  static readonly HUMAN: PrincipalKind = new PrincipalKind('human');
  static readonly AGENT: PrincipalKind = new PrincipalKind('agent');
  static readonly MACHINE: PrincipalKind = new PrincipalKind('machine');
  static readonly ORG: PrincipalKind = new PrincipalKind('org');
  static readonly PROJECT: PrincipalKind = new PrincipalKind('project');
  static readonly PLATFORM: PrincipalKind = new PrincipalKind('platform');

  static of(raw: string): Result<PrincipalKind, InvalidPrincipalKindError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new PrincipalKind(raw as PrincipalKindValue));
    }
    return err(new InvalidPrincipalKindError(raw));
  }

  equals(other: PrincipalKind): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
