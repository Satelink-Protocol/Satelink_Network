/**
 * JSON-RPC ChainReader — read-only. Two calls per observation:
 *   eth_getTransactionReceipt (status, logs, block) and eth_blockNumber (tip).
 * It decodes ERC-20 Transfer logs; it never sends transactions or holds a key.
 */

import type { ChainKey } from '../chains.js';
import { CHAINS } from '../chains.js';
import type {
  ChainReader,
  ObserveTransferInput,
  TransferObservation,
  TxStatus,
} from '../ports/chain-reader.js';

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

interface RpcLog {
  readonly address: string;
  readonly topics: string[];
  readonly data: string;
}
interface RpcReceipt {
  readonly status: string;
  readonly blockNumber: string;
  readonly logs: RpcLog[];
}

/** Strip a 32-byte topic to a lowercased 0x address (last 20 bytes). */
function topicToAddress(topic: string): string {
  return ('0x' + topic.slice(-40)).toLowerCase();
}

export class JsonRpcChainReader implements ChainReader {
  private readonly rpcByChain: Readonly<Record<ChainKey, string>>;

  constructor(rpcByChain: Record<ChainKey, string>) {
    this.rpcByChain = rpcByChain;
  }

  private async rpc<T>(chainKey: ChainKey, method: string, params: unknown[]): Promise<T> {
    const url = this.rpcByChain[chainKey];
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) {
      throw new Error(`RPC ${method} on ${chainKey} HTTP ${res.status}`);
    }
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) {
      throw new Error(`RPC ${method} on ${chainKey}: ${body.error.message ?? 'error'}`);
    }
    return body.result as T;
  }

  private async receiptAndConfirmations(
    chainKey: ChainKey,
    txHash: string,
  ): Promise<{ receipt: RpcReceipt | null; confirmations: number; success: boolean }> {
    const receipt = await this.rpc<RpcReceipt | null>(chainKey, 'eth_getTransactionReceipt', [txHash]);
    if (receipt === null) return { receipt: null, confirmations: 0, success: false };
    const tipHex = await this.rpc<string>(chainKey, 'eth_blockNumber', []);
    const tip = BigInt(tipHex);
    const block = BigInt(receipt.blockNumber);
    const confirmations = tip >= block ? Number(tip - block) : 0;
    return { receipt, confirmations, success: receipt.status === '0x1' };
  }

  async getTxStatus(input: { chainKey: ChainKey; txHash: string }): Promise<TxStatus> {
    const { receipt, confirmations, success } = await this.receiptAndConfirmations(
      input.chainKey,
      input.txHash,
    );
    return { found: receipt !== null, success, confirmations };
  }

  async observeTransfer(input: ObserveTransferInput): Promise<TransferObservation> {
    const { receipt, confirmations, success } = await this.receiptAndConfirmations(
      input.chainKey,
      input.txHash,
    );
    if (receipt === null) {
      return { found: false, success: false, confirmations: 0, amountToRecipientMinor: 0n };
    }

    const token = input.tokenContract.toLowerCase();
    const recipient = input.expectedRecipient.toLowerCase();
    let amountToRecipientMinor = 0n;
    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() === token &&
        log.topics.length === 3 &&
        log.topics[0]!.toLowerCase() === TRANSFER_TOPIC &&
        topicToAddress(log.topics[2]!) === recipient
      ) {
        amountToRecipientMinor += BigInt(log.data);
      }
    }

    return { found: true, success, confirmations, amountToRecipientMinor };
  }
}

/** Build the per-chain RPC url map from worker config. */
export function rpcMapFrom(cfg: { baseRpcUrl: string; polygonRpcUrl: string }): Record<ChainKey, string> {
  return {
    base: cfg.baseRpcUrl,
    polygon: cfg.polygonRpcUrl,
  };
}
