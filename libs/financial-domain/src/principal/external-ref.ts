/**
 * ExternalRef — an OPAQUE correlation key to an external identity (a wallet
 * address, an API key, etc.). Non-empty, bounded string. It is the idempotency
 * key the backfill uses (partial unique index on principals.external_ref).
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 256;

export class InvalidExternalRefError {
  readonly tag = 'InvalidExternalRefError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidExternalRefError: ${this.reason}`;
  }
}

export class ExternalRef {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<ExternalRef, InvalidExternalRefError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidExternalRefError('external ref must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidExternalRefError(`external ref must be <= ${MAX_LEN} characters`));
    }
    return ok(new ExternalRef(raw));
  }

  equals(other: ExternalRef): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
