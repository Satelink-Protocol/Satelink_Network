/**
 * AuthorizationId — identity of an Authorization. Non-empty, bounded string.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 200;

export class InvalidAuthorizationIdError {
  readonly tag = 'InvalidAuthorizationIdError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidAuthorizationIdError: ${this.reason}`;
  }
}

export class AuthorizationId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<AuthorizationId, InvalidAuthorizationIdError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidAuthorizationIdError('authorization id must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidAuthorizationIdError(`authorization id must be <= ${MAX_LEN} chars`));
    }
    return ok(new AuthorizationId(raw));
  }

  equals(other: AuthorizationId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
