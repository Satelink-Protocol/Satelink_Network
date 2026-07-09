// apps/api/src/payments/x402/config.js
// x402 v2 parallel payment rail — env-driven configuration.
//
// Feature flag: when X402_ENABLED != 'true' the whole rail is inert and the
// gateway behaves byte-identically to today (middleware.js returns a
// pass-through). Read at call time (not module load) so tests can flip it.
//
// Settlement auth: the Coinbase CDP facilitator requires CDP_API_KEY_ID and
// CDP_API_KEY_SECRET for verify/settle (list is unauthenticated). Those are
// read lazily by @coinbase/x402's createCdpAuthHeaders at request time.

// CAIP-2 chain ids the v2 SDK expects. Human aliases kept for env ergonomics.
const NETWORK_ALIASES = {
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
};

export function resolveNetwork(network) {
  return NETWORK_ALIASES[network] || network;
}

export function getX402Config() {
  return {
    enabled: process.env.X402_ENABLED === 'true',
    // USD price per RPC call on the x402 rail (USDC has 6 decimals; the
    // ExactEvmScheme money parser converts "$0.001" to atomic units).
    // Floor: the CDP facilitator rejects verify with amount_too_low below
    // $0.001 (empirically confirmed 2026-07-09; $0.0005 is refused).
    pricePerCall: process.env.X402_PRICE_PER_CALL || '0.001',
    payTo: process.env.X402_PAY_TO || '0x966E1Ae22996545015b1414B35234b10719d7Ad4',
    network: resolveNetwork(process.env.X402_NETWORK || 'base'),
    facilitatorUrl:
      process.env.X402_FACILITATOR_URL ||
      'https://api.cdp.coinbase.com/platform/v2/x402',
  };
}
