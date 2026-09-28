#!/usr/bin/env node
// scripts/ops/m2-pay.mjs
//
// Gate M2 payment client — the ONE real, non-founder x402 payment the gate
// needs. Written against the packages actually installed in this workspace
// (hoisted to root node_modules; resolved and introspected before writing
// this file — not from memory):
//   @x402/core@2.18.0, @x402/evm@2.18.0, @x402/fetch@2.19.0, viem@2.55.2
//
// Usage:
//   PAYER_PRIVATE_KEY=0x... node scripts/ops/m2-pay.mjs
//
// PAYER_PRIVATE_KEY must be a funded, non-founder wallet's private key
// (Base, eip155:8453 — matches prod's X402_NETWORK) holding a little USDC
// (the resource costs $0.10 = 1,000 calls, prod's bundle price) plus a
// little ETH for gas. The key is read from the environment ONLY: never
// logged, never written to disk, never read from a file, and never
// referenced again once the signer account is derived from it below.
//
// What this does:
//   1. Builds an x402Client, registers the EVM `exact` scheme
//      (@x402/evm's registerExactEvmScheme) for eip155:8453 with a viem
//      LocalAccount signer derived from PAYER_PRIVATE_KEY.
//   2. Wraps fetch with @x402/fetch's wrapFetchWithPayment — on the
//      server's first 402 it decodes the PAYMENT-REQUIRED header, signs an
//      EIP-3009 transfer authorization (registerExactEvmScheme's default
//      assetTransferMethod), retries the POST with the payment header, and
//      the server verifies + settles via the CDP facilitator before
//      serving the call.
//   3. POSTs the exact eth_blockNumber JSON-RPC call to
//      https://api.satelink.network/rpc/polygon.
//   4. Decodes the response's PAYMENT-RESPONSE header (falls back to
//      X-PAYMENT-RESPONSE) with @x402/core's decodePaymentResponseHeader
//      and prints the settlement tx hash + HTTP status — the tx hash Gate
//      M2 (scripts/ops/m2-gate.sh) needs.

import { x402Client } from '@x402/core/client';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { privateKeyToAccount } from 'viem/accounts';

const RESOURCE_URL = 'https://api.satelink.network/rpc/polygon';
const NETWORK = 'eip155:8453'; // Base — matches prod's X402_NETWORK (config.js)
const RPC_BODY = { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 };

// Exits non-zero with a clean, single-line message — never a raw stack
// trace — and never includes the key value in any message it prints.
function fail(message) {
  console.error(`m2-pay: ${message}`);
  process.exit(1);
}

function readPayerAccount() {
  const rawKey = process.env.PAYER_PRIVATE_KEY;
  if (!rawKey) {
    fail(
      'PAYER_PRIVATE_KEY is not set. Run:\n' +
      '  PAYER_PRIVATE_KEY=0x... node scripts/ops/m2-pay.mjs'
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
    fail(
      'PAYER_PRIVATE_KEY is not a 32-byte hex private key ' +
      '(expected 0x followed by 64 hex characters). Value not logged.'
    );
  }
  try {
    // rawKey is not referenced again after this call.
    return privateKeyToAccount(rawKey);
  } catch (err) {
    fail(`could not derive a signer account from PAYER_PRIVATE_KEY: ${err.message}`);
  }
}

async function main() {
  const account = readPayerAccount();

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account, networks: [NETWORK] });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  console.log(`m2-pay: paying from ${account.address}`);
  console.log(`m2-pay: POST ${RESOURCE_URL}`);

  let response;
  try {
    response = await fetchWithPayment(RESOURCE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(RPC_BODY),
    });
  } catch (err) {
    fail(`request failed: ${err.message}`);
    return; // unreachable — fail() exits the process
  }

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = bodyText;
  }

  const settleHeader =
    response.headers.get('PAYMENT-RESPONSE') || response.headers.get('X-PAYMENT-RESPONSE');
  let settleResponse = null;
  if (settleHeader) {
    try {
      settleResponse = decodePaymentResponseHeader(settleHeader);
    } catch (err) {
      console.error(`m2-pay: could not decode PAYMENT-RESPONSE header: ${err.message}`);
    }
  }

  console.log(`m2-pay: HTTP status: ${response.status}`);
  if (settleResponse) {
    console.log(`m2-pay: settlement success: ${settleResponse.success}`);
    console.log(`m2-pay: settlement tx hash: ${settleResponse.transaction}`);
    console.log(`m2-pay: network: ${settleResponse.network}`);
    console.log(`m2-pay: payer: ${settleResponse.payer || account.address}`);
  } else {
    console.error(
      'm2-pay: no PAYMENT-RESPONSE header on the final response — payment did NOT settle.'
    );
    console.log('m2-pay: response body:', typeof body === 'string' ? body : JSON.stringify(body));
  }

  if (response.status !== 200 || !settleResponse || !settleResponse.success) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  fail(`unexpected error: ${err.message}`);
});
