/**
 * AccountState — lifecycle: open <-> frozen -> closed(terminal).
 * Transition legality is enforced by the Account aggregate.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type AccountStateValue = 'open' | 'frozen' | 'closed';

const VALUES: readonly AccountStateValue[] = ['open', 'frozen', 'closed'];

export class InvalidAccountStateError {
  readonly tag = 'InvalidAccountStateError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidAccountStateError: "${this.value}" is not a valid account state`;
  }
}

export class AccountState {
  private constructor(readonly value: AccountStateValue) {
    Object.freeze(this);
  }

  static readonly OPEN: AccountState = new AccountState('open');
  static readonly FROZEN: AccountState = new AccountState('frozen');
  static readonly CLOSED: AccountState = new AccountState('closed');

  static of(raw: string): Result<AccountState, InvalidAccountStateError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new AccountState(raw as AccountStateValue));
    }
    return err(new InvalidAccountStateError(raw));
  }

  isTerminal(): boolean {
    return this.value === 'closed';
  }

  equals(other: AccountState): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
