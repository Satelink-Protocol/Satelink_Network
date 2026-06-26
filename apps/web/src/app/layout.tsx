import type { Metadata } from "next";
import "./globals.css";

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect fill='%23408A71' rx='18' width='100' height='100'/><text x='50' y='66' font-size='48' fill='white' text-anchor='middle' font-family='system-ui' font-weight='700'>S</text></svg>";

export const metadata: Metadata = {
  metadataBase: new URL("https://satelink.network"),
  title: "Satelink - Decentralized Infrastructure Network | DePIN",
  description:
    "Run real workloads on distributed hardware. Developers pay per call, node operators earn USDT. On-chain settlement on Polygon.",
  keywords:
    "DePIN, decentralized infrastructure, RPC gateway, Polygon, USDT settlement, node operator earnings, Web3, blockchain API",
  authors: [{ name: "Satelink Network" }],
  robots: "index, follow",
  alternates: { canonical: "https://satelink.network" },
  icons: { icon: FAVICON },
  openGraph: {
    type: "website",
    url: "https://satelink.network",
    title: "Satelink - Decentralized Infrastructure Network",
    description:
      "Monetize idle hardware with real workloads. On-chain USDT settlement on Polygon.",
    images: ["https://satelink.network/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    site: "@satelinknet",
    title: "Satelink - Decentralized Infrastructure",
    description: "Monetize idle hardware. Real workloads. On-chain settlement.",
  },
};

const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Satelink Network",
  description:
    "Decentralized infrastructure platform with on-chain USDT settlement on Polygon",
  url: "https://satelink.network",
  logo: "https://satelink.network/logo.svg",
  foundingDate: "2025",
  sameAs: [
    "https://github.com/Satelink-Protocol",
    "https://twitter.com/satelinknet",
    "https://discord.gg/satelink",
  ],
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
          href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
