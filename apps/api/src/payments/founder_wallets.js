// apps/api/src/payments/founder_wallets.js
// Wallets funded/controlled by the founder for testing the payment rails.
// Any settlement whose payer is in this list is ledger-flagged is_test_data —
// founder-funded flows must never count as external revenue, regardless of
// network. Addresses MUST be lowercase (comparisons are done on lower()).

export const FOUNDER_WALLETS = [
  '0x5cbda3a1c0f1b28fecea1d919785321e88f9fa97',
  '0x966e1ae22996545015b1414b35234b10719d7ad4', // treasury / deployer
  '0x175727a8486a7eb3ac4bcf2a1a89fd2d58ca0dfd', // mainnet validation machine
  '0x55691946766f4666c786ea8ee2bea176ecc3a841', // sepolia validation ephemeral
];

export function isFounderWallet(address) {
  return typeof address === 'string' && FOUNDER_WALLETS.includes(address.toLowerCase());
}

// API-key-based revenue sites (oracle, mev_relay, ai_gateway, webhooks,
// rpc_billing, bandwidth_proxy) don't have a wallet address on hand — only
// an api_key. Unauthenticated traffic ('public'/'anonymous' sentinels, or no
// key at all) and traffic from a founder-owned key (resolved via the key's
// bound wallet_address in api_credits) both count as is_test_data, same as
// the api_deposits pattern in PR #268.
export async function isFounderApiKey(pool, apiKey) {
  if (!apiKey || apiKey === 'public' || apiKey === 'anonymous') return true;
  try {
    const r = await pool.query(
      'SELECT wallet_address FROM api_credits WHERE api_key = $1',
      [apiKey]
    );
    return isFounderWallet(r.rows[0]?.wallet_address);
  } catch {
    return false;
  }
}
