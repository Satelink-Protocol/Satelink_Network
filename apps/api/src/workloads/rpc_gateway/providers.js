/**
 * Multi-Provider RPC Pool Configuration
 * S1-RPC-001: Multi-provider pool — Polygon Amoy + mainnet + Ethereum
 *
 * Goal: 5,000 RPC requests/second via provider pooling
 * - Multiple providers per chain for redundancy
 * - Latency metrics tracked per provider
 * - Circuit breaker state per provider
 */

// Ankr requires valid API key — disable if not set or invalid
const ANKR_KEY = process.env.ANKR_API_KEY;
const ANKR_VALID = ANKR_KEY &&
  ANKR_KEY.length > 10 &&
  !ANKR_KEY.includes('REPLACE') &&
  !ANKR_KEY.includes('demo') &&
  !ANKR_KEY.includes('your-');

if (!ANKR_VALID) {
  console.log('[RPC] Ankr disabled — no valid ANKR_API_KEY');
}

const PROVIDER_CONFIGS = {
  "polygon-amoy": {
    chainId: 80002,
    name: "Polygon Amoy Testnet",
    providers: [
      {
        id: "polygon-amoy-official",
        url:
          process.env.RPC_POLYGON_AMOY_1 ||
          "https://rpc-amoy.polygon.technology",
        priority: 1,
        rateLimit: 100,
        type: "public",
      },
      {
        id: "alchemy-amoy",
        url:
          process.env.ALCHEMY_AMOY_URL ||
          `https://polygon-amoy.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || "demo"}`,
        priority: 2,
        rateLimit: 300,
        type: "alchemy",
      },
      {
        id: "ankr-amoy",
        url:
          process.env.ANKR_AMOY_URL ||
          (ANKR_VALID ? `https://rpc.ankr.com/polygon_amoy/${ANKR_KEY}` : null),
        priority: 3,
        rateLimit: 100,
        type: "ankr",
        enabled: ANKR_VALID || !!process.env.ANKR_AMOY_URL,
      },
      {
        id: "drpc-amoy",
        url: process.env.DRPC_AMOY_URL || "https://polygon-amoy.drpc.org",
        priority: 4,
        rateLimit: 100,
        type: "drpc",
      },
    ],
  },

  polygon: {
    chainId: 137,
    name: "Polygon PoS Mainnet",
    providers: [
      {
        id: "llamarpc-polygon",
        url: process.env.RPC_POLYGON_1 || "https://polygon.llamarpc.com",
        priority: 1,
        rateLimit: 100,
        type: "public",
        enabled: false, // Disabled: endpoint permanently down, tripped circuit breaker 2550+ times
      },
      {
        id: "alchemy-polygon",
        url:
          process.env.ALCHEMY_POLYGON_URL ||
          (process.env.ALCHEMY_POLYGON_KEY || process.env.ALCHEMY_API_KEY
            ? `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_POLYGON_KEY || process.env.ALCHEMY_API_KEY}`
            : null),
        priority: 2,
        rateLimit: 25,
        type: "alchemy",
        enabled: !!(process.env.ALCHEMY_POLYGON_URL || process.env.ALCHEMY_POLYGON_KEY || process.env.ALCHEMY_API_KEY),
      },
      {
        id: "publicnode-polygon",
        url: process.env.PUBLICNODE_POLYGON_URL || "https://polygon-bor-rpc.publicnode.com",
        priority: 3,
        rateLimit: 100,
        type: "public",
        enabled: true,
      },
      {
        id: "ankr-polygon",
        url:
          process.env.ANKR_POLYGON_URL ||
          (ANKR_VALID ? `https://rpc.ankr.com/polygon/${ANKR_KEY}` : null),
        priority: 3,
        rateLimit: 100,
        type: "ankr",
        enabled: false,
      },
      {
        id: "drpc-polygon",
        url: process.env.DRPC_POLYGON_URL || "https://polygon.drpc.org",
        priority: 4,
        rateLimit: 100,
        type: "drpc",
      },
    ],
  },

  ethereum: {
    chainId: 1,
    name: "Ethereum Mainnet",
    providers: [
      {
        id: "llamarpc-eth",
        url: process.env.LLAMARPC_ETH_URL || "https://eth.llamarpc.com",
        priority: 1,
        rateLimit: 100,
        type: "public",
        enabled: false, // Disabled: llamarpc endpoints down, see llamarpc-polygon
      },
      {
        id: "alchemy-eth",
        url:
          process.env.ALCHEMY_ETH_URL ||
          (process.env.ALCHEMY_API_KEY
            ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
            : null),
        priority: 2,
        rateLimit: 300,
        type: "alchemy",
        enabled: !!(process.env.ALCHEMY_ETH_URL || process.env.ALCHEMY_API_KEY),
      },
      {
        id: "ankr-eth",
        url: process.env.ANKR_ETH_URL || (ANKR_VALID ? `https://rpc.ankr.com/eth/${ANKR_KEY}` : null),
        priority: 3,
        rateLimit: 100,
        type: "ankr",
        enabled: ANKR_VALID || !!process.env.ANKR_ETH_URL,
      },
      {
        id: "drpc-eth",
        url: process.env.DRPC_ETH_URL || "https://eth.drpc.org",
        priority: 5,
        rateLimit: 100,
        type: "drpc",
      },
    ],
  },

  arbitrum: {
    chainId: 42161,
    name: "Arbitrum One",
    providers: [
      {
        id: "arbitrum-official",
        url: "https://arb1.arbitrum.io/rpc",
        priority: 1,
        rateLimit: 100,
        type: "public",
      },
      {
        id: "ankr-arbitrum",
        url: ANKR_VALID ? `https://rpc.ankr.com/arbitrum/${ANKR_KEY}` : null,
        priority: 2,
        rateLimit: 100,
        type: "ankr",
        enabled: ANKR_VALID,
      },
    ],
  },

  base: {
    chainId: 8453,
    name: "Base Mainnet",
    providers: [
      {
        id: "base-official",
        url: "https://mainnet.base.org",
        priority: 1,
        rateLimit: 100,
        type: "public",
      },
      {
        id: "ankr-base",
        url: ANKR_VALID ? `https://rpc.ankr.com/base/${ANKR_KEY}` : null,
        priority: 2,
        rateLimit: 100,
        type: "ankr",
        enabled: ANKR_VALID,
      },
    ],
  },

  solana: {
    chainId: 0,
    name: "Solana Mainnet",
    providers: [
      {
        id: "solana-official",
        url: "https://api.mainnet-beta.solana.com",
        priority: 1,
        rateLimit: 40,
        type: "public",
        enabled: false, // Disabled: strict rate limits and method restrictions
      },
    ],
  },
};

const CHAIN_ALIASES = {
  // Name aliases
  amoy: "polygon-amoy",
  matic: "polygon",
  eth: "ethereum",
  arb: "arbitrum",
  "base-mainnet": "base",
  sol: "solana",
  // Chain ID aliases (for machine clients like Chainlist)
  "80002": "polygon-amoy",
  "137": "polygon",
  "1": "ethereum",
  "42161": "arbitrum",
  "8453": "base",
};

export function getChainConfig(chainKey) {
  const normalized = CHAIN_ALIASES[chainKey] || chainKey;
  return PROVIDER_CONFIGS[normalized] || null;
}

export function getProviders(chainKey) {
  const config = getChainConfig(chainKey);
  if (!config) return [];
  return config.providers.filter(p => p.url && p.enabled !== false);
}

export function getPrimaryProvider(chainKey) {
  const providers = getProviders(chainKey);
  return providers.length > 0 ? providers[0] : null;
}

export function getSupportedChains() {
  return Object.keys(PROVIDER_CONFIGS);
}

export function getChainId(chainKey) {
  const config = getChainConfig(chainKey);
  return config ? config.chainId : null;
}

export { PROVIDER_CONFIGS, CHAIN_ALIASES };
