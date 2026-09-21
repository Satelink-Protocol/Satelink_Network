import type { Metadata } from "next";
import "../../../../packages/ui/src/styles/theme.css";
import "./globals.css";

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect fill='%23408A71' rx='18' width='100' height='100'/><text x='50' y='66' font-size='48' fill='white' text-anchor='middle' font-family='system-ui' font-weight='700'>S</text></svg>";

export const metadata: Metadata = {
  metadataBase: new URL("https://satelink.network"),
  title: {
    default: "Satelink — Derived Trading Intelligence for the Machine Economy",
    template: "%s | Satelink",
  },
  description:
    "Derived trading intelligence — funding-rate divergence, open interest shifts, market microstructure — computed from public market data, never raw feeds redistributed. One-time USD credit packs from $0.01/call. Runs on our own pay-per-call Polygon RPC gateway ($0.00003/call).",
  keywords: [
    "trading intelligence",
    "funding rate",
    "open interest",
    "market microstructure",
    "derived analytics API",
    "DePIN",
    "RPC gateway",
    "Polygon RPC",
    "pay per call API",
    "USDT settlement",
    "machine economy",
    "HTTP 402",
  ],
  authors: [{ name: "Satelink Network" }],
  robots: "index, follow",
  alternates: { canonical: "https://satelink.network" },
  icons: { icon: FAVICON },
  openGraph: {
    type: "website",
    url: "https://satelink.network",
    siteName: "Satelink Network",
    title: "Satelink — Derived Trading Intelligence for the Machine Economy",
    description:
      "Funding-rate divergence, open interest shifts, and market microstructure — derived from public market data. One-time USD credit packs, no subscription. Built on our own pay-per-call Polygon RPC gateway.",
    images: ["https://satelink.network/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Satelink — Derived Trading Intelligence for the Machine Economy",
    description:
      "Derived market analytics for machine-commerce agents. One-time USD credit packs from $0.01/call, or pay per call via x402 — no subscription.",
  },
};

const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Satelink Network",
  description:
    "Derived trading intelligence and pay-per-call Polygon RPC, metered per call with on-chain and Dodo Payments settlement.",
  url: "https://satelink.network",
  email: "satelinknetwork@gmail.com",
  foundingDate: "2025",
  sameAs: ["https://github.com/Satelink-Protocol/x402-kit"],
};

// Primary product for this merchant account.
const INTELLIGENCE_PRODUCT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Satelink Trading Intelligence",
  description:
    "Derived trading intelligence — funding-rate heatmaps, open-interest shifts, liquidation clusters, market microstructure — computed from public market data. Raw exchange feeds are never redistributed.",
  url: "https://satelink.network/intelligence",
  offers: {
    "@type": "Offer",
    price: "0.01",
    priceCurrency: "USD",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: "0.01",
      priceCurrency: "USD",
      unitText: "per call",
    },
    description:
      "One-time USD credit pack (non-recurring), spent per call at $0.01/call. See /pricing.",
    availability: "https://schema.org/InStock",
  },
};

// Secondary — the infrastructure the intelligence product runs on, also sold
// directly.
const RPC_PRODUCT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Satelink RPC Gateway",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any (HTTP API)",
  url: "https://rpc.satelink.network",
  description:
    "Multi-chain JSON-RPC gateway (Polygon, Ethereum, Arbitrum, Base) metered at a flat $0.00003 USDT per call with a 500-calls/day free tier.",
  offers: {
    "@type": "Offer",
    price: "0.00003",
    priceCurrency: "USD",
    description: "Flat metered rate per RPC call, from the same one-time USD credit pack.",
  },
};

// Runs before paint to avoid a flash of the wrong theme (same logic as the
// approved static page's initTheme()).
const THEME_INIT = `(function(){try{var s=localStorage.getItem('satelink-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme',s||(d?'dark':'light'));}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(INTELLIGENCE_PRODUCT_JSON_LD) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(RPC_PRODUCT_JSON_LD) }}
        />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Satelink Changelog"
          href="https://satelink.network/feed.xml"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
