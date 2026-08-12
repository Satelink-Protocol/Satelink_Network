/**
 * FakeChainReader — deterministic ChainReader for tests. Keyed by tx hash so a
 * test can seed exactly what the chain "says" without any network.
 */

import type { ChainKey } from '../chains.js';
import type {
  ChainReader,
  ObserveTransferInput,
  TransferObservation,
  TxStatus,
} from '../ports/chain-reader.js';

export class FakeChainReader implements ChainReader {
  private readonly byTx = new Map<string, TransferObservation>();

  set(txHash: string, obs: TransferObservation): this {
    this.byTx.set(txHash.toLowerCase(), obs);
    return this;
  }

  async observeTransfer(input: ObserveTransferInput): Promise<TransferObservation> {
    return (
      this.byTx.get(input.txHash.toLowerCase()) ?? {
        found: false,
        success: false,
        confirmations: 0,
        amountToRecipientMinor: 0n,
      }
    );
  }

  async getTxStatus(input: { chainKey: ChainKey; txHash: string }): Promise<TxStatus> {
    const obs = this.byTx.get(input.txHash.toLowerCase());
    if (obs === undefined) return { found: false, success: false, confirmations: 0 };
    return { found: obs.found, success: obs.success, confirmations: obs.confirmations };
  }
}
