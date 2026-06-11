import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Documentation | Satelink Network",
  description: "Satelink Network documentation — RPC endpoints, pricing, deposits, and node operation.",
};

const WIKI = "https://github.com/Satelink-Protocol/Satelink_Network/wiki";
const API = "https://rpc.satelink.network";

const sections = [
  {
    title: "Guides",
    links: [
      { label: "Full documentation (GitHub wiki)", href: WIKI, external: true },
      { label: "Deposit USDT for credits", href: "/satelink/os/deposit", external: false },
      { label: "API key management", href: "/satelink/os/api-keys", external: false },
    ],
  },
  {
    title: "API Reference (live endpoints)",
    links: [
      { label: "Provider metadata — /provider.json", href: `${API}/provider.json`, external: true },
      { label: "Pricing catalog — /api/pricing", href: `${API}/api/pricing`, external: true },
      { label: "Network status — /api/status", href: `${API}/api/status`, external: true },
      { label: "OpenAPI spec — /openapi.json", href: `${API}/openapi.json`, external: true },
    ],
  },
  {
    title: "RPC Endpoints",
    links: [
      { label: "Polygon Mainnet — /rpc/polygon", href: `${API}/rpc/polygon`, external: true },
      { label: "Ethereum — /rpc/ethereum", href: `${API}/rpc/ethereum`, external: true },
      { label: "Arbitrum One — /rpc/arbitrum", href: `${API}/rpc/arbitrum`, external: true },
      { label: "Base — /rpc/base", href: `${API}/rpc/base`, external: true },
    ],
  },
];

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">Documentation</h1>
        <p className="mt-2 text-sm text-slate-400">
          Free tier: 500 requests/day per IP, no API key required. Paid usage settles in USDT on Polygon.
        </p>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {section.title}
              </h2>
              <ul className="mt-3 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/60">
                {section.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-4 py-3 text-sm text-slate-200 hover:bg-slate-800/60"
                      >
                        {link.label} <span className="text-slate-500">↗</span>
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="block px-4 py-3 text-sm text-slate-200 hover:bg-slate-800/60"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
