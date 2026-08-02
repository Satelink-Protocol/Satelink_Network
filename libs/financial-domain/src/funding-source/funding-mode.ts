/**
 * FundingMode — how funds are made available on this source.
 *
 *   prepaid       — funds deposited up front (e.g. USDT credit deposit).
 *   authorization — pull against a standing authorization (e.g. x402/EIP-3009).
 *   escrow        — funds held in escrow, released on settlement.
 *
 * Closed set.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type FundingModeValue = 'prepaid' | 'authorization' | 'escrow';

const VALUES: readonly FundingModeValue[] = ['prepaid', 'authorization', 'escrow'];

export class InvalidFundingModeError {
  readonly tag = 'InvalidFundingModeError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidFundingModeError: "${this.value}" is not a valid funding mode`;
  }
}

export class FundingMode {
  private constructor(readonly value: FundingModeValue) {
    Object.freeze(this);
  }

  static readonly PREPAID: FundingMode = new FundingMode('prepaid');
  static readonly AUTHORIZATION: FundingMode = new FundingMode('authorization');
  static readonly ESCROW: FundingMode = new FundingMode('escrow');

  static of(raw: string): Result<FundingMode, InvalidFundingModeError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new FundingMode(raw as FundingModeValue));
    }
    return err(new InvalidFundingModeError(raw));
  }

  equals(other: FundingMode): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
