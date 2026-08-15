#!/usr/bin/env node
/**
 * m8-sign-authorization — OFFLINE signer for M8 capacity authorizations.
 *
 * Produces TWO x402 "exact" (EIP-3009 TransferWithAuthorization) envelopes from
 * the SAME wallet:
 *   - main       : value = 2_000_000  ($2.00 USDC) — the standing authorization
 *   - exhaustion : value = 5_000      ($0.005 USDC) — small cap for the Part 3.5
 *                  exhaustion test (a $2 cap would take ~20,000 calls to hit)
 *
 * SECURITY
 *   - Reads the private key from env M8_SIGNER_PRIVATE_KEY at runtime ONLY.
 *   - NEVER echoes the private key. NEVER writes any file. Makes NO network
 *     calls (EIP-712 signing is pure local crypto).
 *   - The printed envelopes are BEARER INSTRUMENTS (they authorize pulling USDC
 *     from your wallet). Do not commit them, paste them into a PR, or log them.
 *
 * Usage:
 *   M8_SIGNER_PRIVATE_KEY=0x<64-hex> node scripts/ops/m8-sign-authorization.mjs
 *
 * Optional env:
 *   M8_VALIDITY_DAYS   validity window length in days (default 30)
 *   M8_PAYTO           recipient (default treasury payTo 0x966E1Ae2…7Ad4)
 */

import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress, toHex } from 'viem';

const BASE_USDC = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
const BASE_CHAIN_ID = 8453;
const DEFAULT_PAYTO = '0x966E1Ae22996545015b1414B35234b10719d7Ad4';

const pk = process.env.M8_SIGNER_PRIVATE_KEY;
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.error('ERROR: set M8_SIGNER_PRIVATE_KEY=0x<64 hex> in the environment.');
  console.error('       (It is read at runtime only and never echoed or persisted.)');
  process.exit(1);
}

const account = privateKeyToAccount(pk);
const payTo = getAddress(process.env.M8_PAYTO || DEFAULT_PAYTO);
const days = Number(process.env.M8_VALIDITY_DAYS || '30');
const nowSec = Math.floor(Date.now() / 1000);
const validAfter = 0n;
const validBefore = BigInt(nowSec + days * 24 * 60 * 60);

const DOMAIN = { name: 'USD Coin', version: '2', chainId: BASE_CHAIN_ID, verifyingContract: BASE_USDC };
const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

async function sign(label, value) {
  const nonce = toHex(randomBytes(32));
  const message = { from: account.address, to: payTo, value, validAfter, validBefore, nonce };
  const signature = await account.signTypedData({
    domain: DOMAIN,
    types: TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });
  return {
    label,
    scheme: 'exact',
    signature,
    signer: account.address,
    domain: { name: DOMAIN.name, version: DOMAIN.version, chainId: DOMAIN.chainId, verifyingContract: DOMAIN.verifyingContract },
    message: {
      from: account.address,
      to: payTo,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  };
}

const main = await sign('main', 2_000_000n);
const exhaustion = await sign('exhaustion', 5_000n);

console.error(`signer address: ${account.address}  (fund with ~$2 USDC on Base for on-chain redeemability)`);
console.error('BEARER INSTRUMENTS below — do not commit, paste into a PR, or log.\n');
process.stdout.write(JSON.stringify({ main, exhaustion }, null, 2) + '\n');
