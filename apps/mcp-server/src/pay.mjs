// apps/mcp-server/src/pay.mjs
// Builds an x402-paying fetch for the Satelink MCP server.
//
// This is the ONE piece that was missing to close the paid loop: the existing
// server forwarded requests to the live, x402-enabled `/rpc/polygon` endpoint
// but never SIGNED a payment — so a 402 was only ever surfaced to the agent as
// text and no external paid call could complete.
//
// Here we wrap globalThis.fetch with @x402/fetch's wrapFetchWithPayment. On a
// 402 Payment Required, the wrapper reads the payment requirements (USDC on
// Base, the Satelink treasury payTo), signs an EIP-3009 authorization with the
// operator's wallet, and retries — exactly the client half of the rail whose
// server half already runs in production (apps/api/src/payments/x402). No new
// facilitator, no new treasury, no new settlement code: production verifies,
// settles on Base, and records the revenue_events_v2 row.
//
// Reuse, not redesign: the wallet key lives ONLY in the operator's process and
// is used ONLY to sign x402 payments. When no key is configured the server
// degrades to plain fetch (free tier / manual-payment surfacing), byte-identical
// to the pre-existing behavior.

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

// Base mainnet in CAIP-2 — the only network the Satelink x402 rail settles on
// (matches X402_NETWORK=eip155:8453 in production).
export const BASE_MAINNET = 'eip155:8453';

function normalizePk(pk) {
  const s = String(pk).trim();
  return s.startsWith('0x') ? s : `0x${s}`;
}

/**
 * Build the fetch the tool executor uses to reach the Satelink RPC.
 *
 * @param {object} opts
 * @param {string} [opts.privateKey]  0x EVM private key of a Base-funded USDC
 *   wallet. Omit to run free-tier / non-paying.
 * @param {string} [opts.network]     CAIP-2 network (default Base mainnet).
 * @returns {{ fetch: typeof fetch, wallet: string|null, canPay: boolean }}
 */
export function buildPayingFetch({ privateKey, network = BASE_MAINNET } = {}) {
  const key = privateKey || process.env.SATELINK_WALLET_PRIVATE_KEY || '';
  if (!key) {
    return { fetch: globalThis.fetch.bind(globalThis), wallet: null, canPay: false };
  }
  const account = privateKeyToAccount(normalizePk(key));
  const signer = toClientEvmSigner(account);
  const client = new x402Client().register(network, new ExactEvmScheme(signer));
  const payFetch = wrapFetchWithPayment(globalThis.fetch.bind(globalThis), client);
  return { fetch: payFetch, wallet: account.address, canPay: true };
}
