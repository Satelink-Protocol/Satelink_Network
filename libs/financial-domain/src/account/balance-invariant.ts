/**
 * BalanceInvariant — the constraint an account's (externally computed) balance
 * must satisfy. The Account does NOT compute or check balance itself; this VO
 * only DECLARES the expected invariant for the application layer to enforce
 * against a balance it derives from the ledger. Stored in accounts.balance_invariant.
 *
 *   non_negative — balance must be >= 0 (e.g. a prepaid capacity account)
 *   non_positive — balance must be <= 0
 *   unrestricted — no sign constraint
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type BalanceInvariantValue = 'non_negative' | 'non_positive' | 'unrestricted';

const VALUES: readonly BalanceInvariantValue[] = ['non_negative', 'non_positive', 'unrestricted'];

export class InvalidBalanceInvariantError {
  readonly tag = 'InvalidBalanceInvariantError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidBalanceInvariantError: "${this.value}" is not a valid balance invariant`;
  }
}

export class BalanceInvariant {
  private constructor(readonly value: BalanceInvariantValue) {
    Object.freeze(this);
  }

  static readonly NON_NEGATIVE: BalanceInvariant = new BalanceInvariant('non_negative');
  static readonly NON_POSITIVE: BalanceInvariant = new BalanceInvariant('non_positive');
  static readonly UNRESTRICTED: BalanceInvariant = new BalanceInvariant('unrestricted');

  static of(raw: string): Result<BalanceInvariant, InvalidBalanceInvariantError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new BalanceInvariant(raw as BalanceInvariantValue));
    }
    return err(new InvalidBalanceInvariantError(raw));
  }

  equals(other: BalanceInvariant): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
