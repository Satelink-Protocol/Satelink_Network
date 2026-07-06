import type { Metadata } from "next";
import "../../../../packages/ui/src/styles/theme.css";
import "./globals.css";

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect fill='%23408A71' rx='18' width='100' height='100'/><text x='50' y='66' font-size='48' fill='white' text-anchor='middle' font-family='system-ui' font-weight='700'>S</text></svg>";

export const metadata: Metadata = {
  metadataBase: new URL("https://satelink.network"),
  title: {
    default: "Satelink — Pay-per-call RPC for the Machine Economy | DePIN",
    template: "%s | Satelink",
  },
  description:
    "DePIN RPC gateway on Polygon PoS. Developers and autonomous machines pay $0.00003 USDT per call — no subscriptions. Node operators earn 50% of routed revenue, settled on-chain.",
  keywords: [
    "DePIN",
    "decentralized infrastructure",
    "RPC gateway",
    "Polygon RPC",
    "pay per call API",
    "USDT settlement",
    "node operator earnings",
    "machine economy",
    "HTTP 402",
    "blockchain API",
  ],
  authors: [{ name: "Satelink Network" }],
  robots: "index, follow",
  alternates: { canonical: "https://satelink.network" },
  icons: { icon: FAVICON },
  openGraph: {
    type: "website",
    url: "https://satelink.network",
    siteName: "Satelink Network",
    title: "Satelink — Pay-per-call RPC for the Machine Economy",
    description:
      "DePIN RPC gateway on Polygon PoS. $0.00003 per call in USDT, permissionless deposits, 50% of revenue to node operators.",
    images: ["https://satelink.network/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Satelink — Pay-per-call RPC for the Machine Economy",
    description:
      "DePIN RPC gateway on Polygon PoS. $0.00003 per call in USDT. Machines onboard via HTTP 402 — no human required.",
  },
};

const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Satelink Network",
  description:
    "DePIN RPC gateway on Polygon PoS with pay-per-call USDT metering, permissionless deposits, and on-chain revenue sharing for node operators.",
  url: "https://satelink.network",
  email: "satelinknetwork@gmail.com",
  foundingDate: "2025",
  sameAs: ["https://github.com/Satelink-Protocol/Satelink_Network"],
};

const PRODUCT_JSON_LD = {
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
    description: "Flat metered rate per RPC call, prepaid in USDT on Polygon PoS.",
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(PRODUCT_JSON_LD) }}
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
