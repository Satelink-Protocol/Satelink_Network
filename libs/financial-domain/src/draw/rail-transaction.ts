/**
 * RailTransaction — immutable value object representing an on-chain or rail
 * transaction. Carries the tx hash, network identifier, and current
 * confirmation count.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export class InvalidRailTransactionError {
  readonly tag = 'InvalidRailTransactionError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidRailTransactionError: ${this.reason}`;
  }
}

export interface RailTransactionProps {
  readonly txHash: string;
  readonly network: string;
  readonly confirmations: number;
}

export class RailTransaction {
  private constructor(private readonly props: RailTransactionProps) {
    Object.freeze(this.props);
    Object.freeze(this);
  }

  static of(
    txHash: string,
    network: string,
    confirmations: number,
  ): Result<RailTransaction, InvalidRailTransactionError> {
    if (typeof txHash !== 'string' || txHash.trim().length === 0) {
      return err(new InvalidRailTransactionError('txHash must be a non-empty string'));
    }
    if (typeof network !== 'string' || network.trim().length === 0) {
      return err(new InvalidRailTransactionError('network must be a non-empty string'));
    }
    if (!Number.isInteger(confirmations) || confirmations < 0) {
      return err(new InvalidRailTransactionError('confirmations must be a non-negative integer'));
    }
    return ok(new RailTransaction({ txHash, network, confirmations }));
  }

  static reconstitute(props: RailTransactionProps): RailTransaction {
    return new RailTransaction(props);
  }

  get txHash(): string {
    return this.props.txHash;
  }
  get network(): string {
    return this.props.network;
  }
  get confirmations(): number {
    return this.props.confirmations;
  }

  withConfirmations(count: number): RailTransaction {
    return new RailTransaction({ ...this.props, confirmations: count });
  }

  toJSON(): RailTransactionProps {
    return { ...this.props };
  }
}
