import type { Metadata } from "next";
import Link from "next/link";
import { docsByCategory } from "@/lib/docs";
import "./docs.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://docs.satelink.network"),
  title: {
    default: "Satelink Documentation",
    template: "%s — Satelink Docs",
  },
  description:
    "Documentation for the Satelink DePIN RPC network: quick start, API reference, billing, node operators, machine customers, and the on-chain revenue model.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const groups = docsByCategory();
  return (
    <div className="docs-root" data-theme="dark">
      <header className="docs-header">
        <div className="docs-header-inner">
          <Link href="/" className="docs-logo">
            <span className="docs-logo-icon">S</span>
            <span>Satelink</span>
            <span className="docs-logo-suffix">Docs</span>
          </Link>
          <nav className="docs-header-nav" aria-label="Documentation header">
            <Link href="/docs/quick-start">Quick Start</Link>
            <Link href="/docs/api-reference">API</Link>
            <Link href="/status">Status</Link>
            <a
              href="https://github.com/Satelink-Protocol/Satelink_Network"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <div className="docs-shell">
        <aside className="docs-sidebar" aria-label="Documentation">
          {groups.map((g) => (
            <div key={g.category} className="docs-nav-group">
              <div className="docs-nav-label">{g.category}</div>
              <ul>
                {g.docs.map((d) => (
                  <li key={d.slug}>
                    <Link href={`/docs/${d.slug}`} className="docs-nav-link">
                      {d.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <div className="docs-main">{children}</div>
      </div>

      <footer className="docs-footer">
        <div className="docs-footer-inner">
          <span>&copy; 2026 Satelink Network</span>
          <nav aria-label="Documentation footer">
            <Link href="/">satelink.network</Link>
            <Link href="/status">Status</Link>
            <Link href="/docs/security">Security</Link>
            <a href="mailto:satelinknetwork@gmail.com">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
