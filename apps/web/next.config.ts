// CLOUDFLARE DNS:
// ops.satelink.network CNAME → cname.vercel-dns.com
// (canonical subdomain DNS list lives in apps/web/src/middleware.ts header)
import type { NextConfig } from "next";

const API_BASE =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  (process.env.NODE_ENV === "production"
    ? "https://rpc.satelink.network"
    : "http://localhost:8080");

const nextConfig: NextConfig = {
  // Transpile the design-system packages (both ship raw TSX from src):
  // @satelink/ui (OS/admin dashboards) and @satelink/web-ui (Satelink Signal —
  // the public-website system, shared with apps/corporate).
  transpilePackages: ["@satelink/ui", "@satelink/web-ui", "@satelink/content", "@satelink/seo"],

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
      // IA-v2 §3 product-move redirects (/intelligence → /products/*, /rpc →
      // /products/rpc) live in src/middleware.ts REDIRECTS — edge-cached, one
      // place, and where that file's own comment says they belong.
      // Migrated to real routes (src/app/terms, src/app/privacy) — the old
      // static public/terms.html and public/privacy.html files are removed,
      // so these paths must redirect rather than 404.
      {
        source: '/terms.html',
        destination: '/terms',
        permanent: true,
      },
      {
        source: '/privacy.html',
        destination: '/privacy',
        permanent: true,
      },
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
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
        ],
      },
      {
        // Checkout flow: allow navigation/connections to the Dodo Payments
        // checkout + API origins used by the existing integration. Kept
        // permissive for scripts/styles (the app relies on Next's inline
        // bootstrap + the pre-paint theme script) — a site-wide strict CSP is
        // a separate follow-up (see docs/web/DECISIONS.md).
        source: '/checkout/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.dodopayments.com https://test.dodopayments.com https://rpc.satelink.network https://api.satelink.network",
              "form-action 'self' https://checkout.dodopayments.com https://test.checkout.dodopayments.com",
              "frame-src https://checkout.dodopayments.com https://test.checkout.dodopayments.com",
            ].join('; '),
          },
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

      // Proxy /api/* to the backend EXCEPT route handlers served by the web app
      // itself: /api/grafana/* (embedded-Grafana BFF), /api/ops-auth
      // (ops.satelink.network session login), /api/dodo-webhook (isolated
      // task-commerce payment webhook — Dodo Payments, task_orders table, has
      // nothing to do with apps/api's money path) and /api/tasks/* (the
      // task-commerce order-start route). Without the exclusion the
      // afterFiles rewrite shadows those local route handlers.
      {
        source: "/api/:path((?!grafana(?:/|$)|ops-auth(?:/|$)|dodo-webhook(?:/|$)|tasks(?:/|$)).*)",
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
