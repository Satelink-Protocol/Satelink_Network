/**
 * RailId — identifies the payment rail a funding source rides (e.g.
 * 'x402-base-usdc', 'usdt-polygon'). Opaque, non-empty, bounded string.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 128;

export class InvalidRailIdError {
  readonly tag = 'InvalidRailIdError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidRailIdError: ${this.reason}`;
  }
}

export class RailId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<RailId, InvalidRailIdError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidRailIdError('rail id must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidRailIdError(`rail id must be <= ${MAX_LEN} chars`));
    }
    return ok(new RailId(raw));
  }

  equals(other: RailId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
