#!/usr/bin/env node
/**
 * m9-sign-schedule — OFFLINE signer for M9 nonce schedules.
 *
 * Produces N (default 5) x402 "exact" (EIP-3009 TransferWithAuthorization)
 * envelopes from the SAME wallet in one sitting, each with:
 *   - a unique random bytes32 nonce
 *   - the same value (default 40,000 = $0.04 USDC)
 *   - the same validity window
 *
 * SECURITY
 *   - Reads the private key from env M9_SIGNER_PRIVATE_KEY at runtime ONLY.
 *   - NEVER echoes the private key. NEVER writes any file. Makes NO network
 *     calls (EIP-712 signing is pure local crypto).
 *   - The printed envelopes are BEARER INSTRUMENTS. Do not commit, paste, or log.
 *
 * Usage:
 *   M9_SIGNER_PRIVATE_KEY=0x<64-hex> node scripts/ops/m9-sign-schedule.mjs
 *
 * Optional env:
 *   M9_NONCE_COUNT      number of nonces to sign (default 5)
 *   M9_VALUE_MINOR      per-nonce value in USDC minor units (default 40000 = $0.04)
 *   M9_VALIDITY_DAYS    validity window length in days (default 30)
 *   M9_PAYTO            recipient (default treasury payTo 0x966E1Ae2…7Ad4)
 */

import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress, toHex } from 'viem';

const BASE_USDC = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
const BASE_CHAIN_ID = 8453;
const DEFAULT_PAYTO = '0x966E1Ae22996545015b1414B35234b10719d7Ad4';

const pk = process.env.M9_SIGNER_PRIVATE_KEY;
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.error('ERROR: set M9_SIGNER_PRIVATE_KEY=0x<64 hex> in the environment.');
  console.error('       (It is read at runtime only and never echoed or persisted.)');
  process.exit(1);
}

const account = privateKeyToAccount(pk);
const payTo = getAddress(process.env.M9_PAYTO || DEFAULT_PAYTO);
const nonceCount = Number(process.env.M9_NONCE_COUNT || '5');
const valueMinor = BigInt(process.env.M9_VALUE_MINOR || '40000');
const days = Number(process.env.M9_VALIDITY_DAYS || '30');
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

async function sign(index) {
  const nonce = toHex(randomBytes(32));
  const message = { from: account.address, to: payTo, value: valueMinor, validAfter, validBefore, nonce };
  const signature = await account.signTypedData({
    domain: DOMAIN,
    types: TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });
  return {
    index,
    scheme: 'exact',
    signature,
    signer: account.address,
    domain: {
      name: DOMAIN.name,
      version: DOMAIN.version,
      chainId: DOMAIN.chainId,
      verifyingContract: DOMAIN.verifyingContract,
    },
    message: {
      from: account.address,
      to: payTo,
      value: valueMinor.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  };
}

const envelopes = [];
for (let i = 0; i < nonceCount; i++) {
  envelopes.push(await sign(i));
}

console.error(`signer: ${account.address}`);
console.error(`nonces: ${nonceCount}, value each: ${valueMinor} minor units ($${(Number(valueMinor) / 1_000_000).toFixed(6)} USDC)`);
console.error(`total capacity: ${(valueMinor * BigInt(nonceCount))} minor units ($${(Number(valueMinor) * nonceCount / 1_000_000).toFixed(6)} USDC)`);
console.error(`validity: now → +${days} days`);
console.error('BEARER INSTRUMENTS below — do not commit, paste into a PR, or log.\n');
process.stdout.write(JSON.stringify(envelopes, null, 2) + '\n');
