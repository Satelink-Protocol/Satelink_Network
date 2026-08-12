/**
 * ChainReader — the reconciler's ONLY window onto chain state.
 *
 * It reports raw on-chain facts (does the tx exist, did it succeed, how many
 * confirmations, how much of the token moved to the expected recipient). The
 * reconciler applies policy (min confirmations, amount match) on top. Injecting
 * this port lets the exit-gate and integration tests run with a fake reader and
 * never touch the network.
 */

import type { ChainKey } from '../chains.js';

export interface ObserveTransferInput {
  readonly chainKey: ChainKey;
  readonly txHash: string;
  /** ERC-20 token contract expected to have emitted the Transfer. */
  readonly tokenContract: string;
  /** Recipient the transfer(s) must be paid to (lowercased 0x address). */
  readonly expectedRecipient: string;
}

export interface TransferObservation {
  /** A receipt for the tx exists on chain. */
  readonly found: boolean;
  /** The tx executed successfully (receipt.status === 0x1). */
  readonly success: boolean;
  /** latest block − tx block (0 when not found). */
  readonly confirmations: number;
  /**
   * Sum, in integer minor units, of every `Transfer` from `tokenContract`
   * whose `to` equals `expectedRecipient` in this tx. 0n means the expected
   * recipient received nothing (missing/redirected payment).
   */
  readonly amountToRecipientMinor: bigint;
}

/** Just the confirmation status of a tx — what the settlement-poller needs. */
export interface TxStatus {
  readonly found: boolean;
  readonly success: boolean;
  readonly confirmations: number;
}

export interface ChainReader {
  observeTransfer(input: ObserveTransferInput): Promise<TransferObservation>;
  getTxStatus(input: { chainKey: ChainKey; txHash: string }): Promise<TxStatus>;
}
