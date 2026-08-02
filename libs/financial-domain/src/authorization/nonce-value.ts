/**
 * NonceValue — the opaque value of a single authorization nonce (e.g. an
 * EIP-3009 bytes32 nonce). Non-empty, bounded string.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 256;

export class InvalidNonceValueError {
  readonly tag = 'InvalidNonceValueError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidNonceValueError: ${this.reason}`;
  }
}

export class NonceValue {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<NonceValue, InvalidNonceValueError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidNonceValueError('nonce value must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidNonceValueError(`nonce value must be <= ${MAX_LEN} chars`));
    }
    return ok(new NonceValue(raw));
  }

  equals(other: NonceValue): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
