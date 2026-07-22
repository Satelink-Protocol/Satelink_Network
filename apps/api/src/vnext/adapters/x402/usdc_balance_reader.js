// USDC balance reader — component 3. Reads the hot wallet's on-chain USDC
// balance (minor units) so the OutboundGuard wallet-floor check is enforceable.
// Real ethers ERC-20 balanceOf on a trusted RPC. The contract is the injected
// boundary (stub in tests, real ethers.Contract in prod).
//
// SECURITY: the address and token are operator config (never caller input), read
// from a trusted RPC (VNEXT_OUTBOUND_RPC_URL). A read error propagates so the
// guard treats balance as unknown and refuses to pay (fail-safe: never pay blind).

import { ethers } from 'ethers';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];

/** @returns async () => string  (USDC minor units) */
export function createBalanceReader({ contract, address }) {
  if (!contract || typeof contract.balanceOf !== 'function') throw new Error('createBalanceReader requires an ERC-20 contract with balanceOf');
  if (!address) throw new Error('createBalanceReader requires a wallet address');
  return async () => (await contract.balanceOf(address)).toString();
}

/** Real env-driven reader, or null if unconfigured (guard then refuses on floor). */
export function buildBalanceReaderFromEnv({ walletAddress } = {}) {
  const url = process.env.VNEXT_OUTBOUND_RPC_URL;
  const address = process.env.VNEXT_OUTBOUND_WALLET_ADDRESS || walletAddress;
  if (!url || !address) return null;
  const provider = new ethers.JsonRpcProvider(url);
  const token = process.env.VNEXT_INBOUND_ASSET || USDC_BASE;
  const contract = new ethers.Contract(token, ERC20_ABI, provider);
  return createBalanceReader({ contract, address });
}

export { USDC_BASE };
