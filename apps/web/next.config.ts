import type { NextConfig } from "next";

const API_BASE =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  (process.env.NODE_ENV === "production"
    ? "https://rpc.satelink.network"
    : "http://localhost:8080");

const nextConfig: NextConfig = {
  // Transpile the @satelink/ui design-system package (ships raw TSX from src).
  transpilePackages: ["@satelink/ui"],

  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  webpack: (config) => {
    // @wagmi/core@3.5.0 statically imports 'accounts' (optional peer dep) in
    // tempo/Connectors.js, causing "Can't resolve 'accounts'" at build time.
    // Aliasing to false creates an empty webpack module to satisfy the import.
    config.resolve.alias = {
      ...config.resolve.alias,
      accounts: false,
      "porto/internal": false,
      porto: false,
      "@safe-global/safe-apps-sdk": false,
      "@safe-global/safe-apps-provider": false,
      "@walletconnect/ethereum-provider": false,
    };
    return config;
  },

  turbopack: {},

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  staticPageGenerationTimeout: 180,

  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },

  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },

  async redirects() {
    return [
      {
        source: '/status',
        destination: 'https://status.satelink.network/',
        permanent: true,
        missing: [{ type: 'host', value: 'status.satelink.network' }],
      },
      {
        source: '/status/',
        destination: 'https://status.satelink.network/',
        permanent: true,
        missing: [{ type: 'host', value: 'status.satelink.network' }],
      },
      {
        source: '/status/:path*',
        destination: 'https://status.satelink.network/:path*',
        permanent: true,
        missing: [{ type: 'host', value: 'status.satelink.network' }],
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/satelink/os/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Vary', value: '*' },
        ],
      },
    ];
  },

  async rewrites() {
    const apiPrefixes = [
      "auth",
      "me",
      "admin-api",
      "node-api",
      "builder-api",
      "dist-api",
      "ent-api",
      "pair",
      "stream",
      "support",
      "beta",
      "webhooks",
      "network-stats",
      "partners",
      "__test",
      // "api" handled explicitly below so /api/grafana/* reaches the embed BFF
      // route handler instead of being proxied to the backend (afterFiles
      // rewrites otherwise shadow the dynamic [...path] route handler).
      "v1",
      "rpc",
      "node",
      "treasury",
      "network",
      "heartbeat",
      "exchange",
      "marketplace",
      "connectors",
      "compute",
      "capacity",
      "amm",
      "protocol",
      "watchdog",
      "settlement",
      "system",
    ];

    return [
      ...apiPrefixes.map((prefix) => ({
        source: `/${prefix}/:path*`,
        destination: `${API_BASE}/${prefix}/:path*`,
      })),

      // Proxy /api/* to the backend EXCEPT /api/grafana/* (served by the
      // embedded-Grafana BFF route handler at apps/web/src/app/api/grafana).
      {
        source: "/api/:path((?!grafana(?:/|$)).*)",
        destination: `${API_BASE}/api/:path`,
      },

      {
        source: "/health",
        destination: `${API_BASE}/health`,
      },

      {
        source: "/metrics",
        destination: `${API_BASE}/metrics`,
      },

      {
        source: "/metrics/json",
        destination: `${API_BASE}/metrics/json`,
      },
    ];
  },
};

export default nextConfig;
