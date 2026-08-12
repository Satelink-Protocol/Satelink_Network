/**
 * asset_currency.js — the single source of truth for what a revenue event is
 * denominated in, derived from the on-chain asset (token contract + chain id).
 *
 * The shadow ledger previously hardcoded every entry to 'USDT'. x402 settles
 * USDC on Base, so the one real row was mislabelled. We now derive the currency
 * from the asset. An UNKNOWN on-chain asset returns null and the caller MUST
 * refuse the write — we never default an on-chain payment to a currency.
 */

// `${token contract lowercased}:${chain id}` -> currency code.
const ASSET_CURRENCY = new Map([
  ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913:8453', 'USDC'], // USDC on Base — the x402 rail
  ['0xc2132d05d31c914a87c6611c10748aeb04b58e8f:137', 'USDT'], // USDT on Polygon — the vault rail
]);

/** Currency code for an on-chain asset, or null when the asset is unknown. */
export function currencyForAsset(asset, chainId) {
  if (typeof asset !== 'string' || chainId === undefined || chainId === null) return null;
  return ASSET_CURRENCY.get(`${asset.toLowerCase()}:${chainId}`) ?? null;
}

// The x402 rail settles USDC on Base by protocol: the CDP facilitator resolves
// the asset, and settlement.js records payment_sources.currency='USDC'. Shadow
// ledger writes ride the same fact via the `x402:<tx>` request id.
export const X402_RAIL_ASSET = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const X402_RAIL_CHAIN_ID = 8453;

// Per-call RPC billing revenue is USD-denominated and has NO on-chain asset. It
// is the platform accounting unit — not asset-derived, and never chain-reconciled
// (it carries no tx hash). Kept explicit so on-chain and off-chain revenue can
// never silently collide under one hardcoded label.
export const PLATFORM_UNIT = 'USDT';

/**
 * Resolve the currency a revenue event is denominated in.
 *   - explicit on-chain asset (`{ asset, chainId }`) → currencyForAsset;
 *     an unknown asset returns null → caller must STOP the write.
 *   - x402 settlement (`requestId` = 'x402:<tx>') → the x402 rail asset → USDC.
 *   - off-chain per-call billing → the platform USD unit.
 *
 * @returns {string|null} currency code, or null ONLY for an unknown on-chain
 *   asset (which must halt the write — never defaulted).
 */
export function resolveRevenueCurrency(event) {
  if (event && (event.asset !== undefined || event.chainId !== undefined)) {
    return currencyForAsset(event.asset, event.chainId);
  }
  if (event && typeof event.requestId === 'string' && event.requestId.startsWith('x402:')) {
    return currencyForAsset(X402_RAIL_ASSET, X402_RAIL_CHAIN_ID);
  }
  return PLATFORM_UNIT;
}
