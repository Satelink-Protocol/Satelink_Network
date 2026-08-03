/**
 * UnitOfWork — coordinates cross-aggregate persistence.
 *
 * M6 introduces a DELIBERATE DEVIATION from ADR-001 (strict eventual consistency).
 * Draw and LedgerTransaction commit in ONE database transaction.
 *
 * Why? If they commit separately and the ledger post fails, we must compensate
 * the Draw. But if the compensation fails, we have lost money (settlement confirmed
 * on-chain, but user not credited). A single transaction prevents this at the cost
 * of a distributed transaction anti-pattern in pure DDD. We accept this trade-off
 * for the money path.
 */

import type { Draw, LedgerTransaction } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';

export class WriteError {
  readonly tag = 'WriteError' as const;
  constructor(
    readonly reason: string,
    readonly cause?: unknown,
  ) {}
  toString(): string {
    return `WriteError: ${this.reason}${this.cause ? ` (${String(this.cause)})` : ''}`;
  }
}

export interface UnitOfWork {
  /**
   * Atomically save the Draw and post the LedgerTransaction.
   * Both must succeed or neither is saved.
   */
  commitDrawAndLedger(draw: Draw, ledgerTxn: LedgerTransaction): Promise<Result<void, WriteError>>;
}
