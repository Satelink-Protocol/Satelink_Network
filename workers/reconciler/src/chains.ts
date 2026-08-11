/**
 * Chain registry — maps a ledger `revenue_event` row to the on-chain facts the
 * reconciler must verify: which chain, which token contract, and the expected
 * recipient (the vault / payTo address).
 *
 * Today exactly one settlement kind exists: x402 (EIP-3009 USDC on Base). Its
 * ledger ref_id is `x402:0x<txhash>`. Polygon USDT vault deposits are declared
 * here for when they appear, but no such ledger row exists yet.
 *
 * ⚠ Currency-label wrinkle (documented, not hidden): the on-chain token for the
 * x402 kind is USDC, while the shadow ledger records the entry currency as USDT.
 * Both are 6-decimal. The reconciler compares amounts in integer minor units and
 * asserts `tokenDecimals === ledgerDecimals` before comparing; it never
 * constructs two different-currency Money objects (that is a compile error).
 */

import { USDC, USDT, type Currency } from '@satelink/kernel';

export type ChainKey = 'base' | 'polygon';

export interface ChainDescriptor {
  readonly chainKey: ChainKey;
  readonly chainId: number;
  /** Which config field holds the RPC url. */
  readonly rpcField: 'baseRpcUrl' | 'polygonRpcUrl';
}

export const CHAINS: Readonly<Record<ChainKey, ChainDescriptor>> = {
  base: { chainKey: 'base', chainId: 8453, rpcField: 'baseRpcUrl' },
  polygon: { chainKey: 'polygon', chainId: 137, rpcField: 'polygonRpcUrl' },
};

/** What the reconciler must verify on-chain for one ledger revenue_event row. */
export interface ReconcileTarget {
  readonly chain: ChainDescriptor;
  readonly txHash: string;
  /** ERC-20 token contract that must have emitted the Transfer. */
  readonly tokenContract: string;
  /** Address the transfer must be paid to. */
  readonly expectedRecipient: string;
  /** The chain token (informational — decimals are what the comparison uses). */
  readonly onChainToken: 'USDC' | 'USDT';
  readonly tokenDecimals: number;
}

/** Expected recipient for the x402 rail — the treasury / payTo (CLAUDE.md). */
export function x402PayTo(env: NodeJS.ProcessEnv = process.env): string {
  return (env.X402_PAY_TO ?? '0x966E1Ae22996545015b1414B35234b10719d7Ad4').toLowerCase();
}

const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const USDT_POLYGON = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';

/**
 * Resolve a ledger row (ref_type='revenue_event') to its on-chain target, or
 * null if it is not an on-chain-reconcilable row (leave those out of drift).
 */
export function targetForRefId(
  refId: string,
  env: NodeJS.ProcessEnv = process.env,
): ReconcileTarget | null {
  const x402 = /^x402:(0x[0-9a-fA-F]{64})$/.exec(refId);
  if (x402) {
    return {
      chain: CHAINS.base,
      txHash: x402[1]!.toLowerCase(),
      tokenContract: USDC_BASE,
      expectedRecipient: x402PayTo(env),
      onChainToken: 'USDC',
      tokenDecimals: 6,
    };
  }
  // Future: Polygon vault deposits, e.g. `vault:0x<txhash>`.
  const vault = /^vault:(0x[0-9a-fA-F]{64})$/.exec(refId);
  if (vault) {
    return {
      chain: CHAINS.polygon,
      txHash: vault[1]!.toLowerCase(),
      tokenContract: USDT_POLYGON,
      expectedRecipient: (env.REVENUE_VAULT_ADDRESS ?? '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF').toLowerCase(),
      onChainToken: 'USDT',
      tokenDecimals: 6,
    };
  }
  return null;
}

/**
 * The kernel Currency to denominate a ledger row's amount in for Money math.
 * Never mixes currencies: both ledger and chain amounts for a row are built in
 * this one currency, after a decimals-equality assertion in the reconciler.
 */
export function currencyForCode(code: string): Currency | null {
  if (code === 'USDT') return USDT;
  if (code === 'USDC') return USDC;
  return null;
}
