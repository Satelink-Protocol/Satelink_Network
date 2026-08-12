/**
 * Chain registry — maps a ledger `revenue_event` row to the on-chain facts the
 * reconciler must verify: which chain, which token contract, and the expected
 * recipient (the vault / payTo address).
 *
 * Today exactly one settlement kind exists: x402 (EIP-3009 USDC on Base). Its
 * ledger ref_id is `x402:0x<txhash>`. Polygon USDT vault deposits are declared
 * here for when they appear, but no such ledger row exists yet.
 *
 * Each target carries the currency the on-chain asset is denominated in. The
 * reconciler requires the ledger row's currency to EQUAL it before building any
 * Money, so both sides of the comparison are the SAME currency and Money's
 * compile-time cross-currency guarantee holds — there is no decimals-magnitude
 * fudge. The shadow ledger now records USDC for x402 (asset-derived), so the
 * x402 row matches its target currency.
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
  /** The currency the on-chain asset is denominated in — the ledger row must
   *  match this exactly (kernel Currency code). No decimals-magnitude fudge. */
  readonly currencyCode: 'USDC' | 'USDT';
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
      currencyCode: 'USDC',
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
      currencyCode: 'USDT',
    };
  }
  return null;
}

/**
 * The kernel Currency to denominate a ledger row's amount in for Money math.
 * The reconciler requires the ledger row's currency to EQUAL the on-chain
 * target's currency before building any Money — cross-currency is flagged, not
 * compared by decimals.
 */
export function currencyForCode(code: string): Currency | null {
  if (code === 'USDT') return USDT;
  if (code === 'USDC') return USDC;
  return null;
}
