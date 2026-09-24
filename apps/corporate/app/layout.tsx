import type { Metadata } from "next";
import "./globals.css";

const SITE = "https://jakuraa.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Jakuraa — machine-commerce infrastructure",
    template: "%s — Jakuraa",
  },
  description:
    "Jakuraa builds infrastructure for the machine economy. We operate Satelink, a pay-per-call RPC and data gateway where autonomous agents and machines settle on-chain.",
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Jakuraa",
    title: "Jakuraa — machine-commerce infrastructure",
    description:
      "Infrastructure for the machine economy. Jakuraa operates Satelink, a pay-per-call RPC and data gateway with on-chain settlement.",
  },
  robots: { index: true, follow: true },
  alternates: { canonical: SITE },
};

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Jakuraa",
  url: SITE,
  description:
    "Jakuraa builds infrastructure for the machine economy and operates the Satelink machine-commerce network.",
  brand: { "@type": "Brand", name: "Satelink", url: "https://satelink.network" },
  sameAs: ["https://satelink.network"],
};

function Nav() {
  return (
    <header className="border-b border-[var(--line)]">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <a href="/" className="text-sm font-semibold tracking-tight">
          Jakuraa
        </a>
        <div className="flex items-center gap-5 text-sm text-[var(--muted)]">
          <a href="/about" className="hover:text-[var(--fg)]">About</a>
          <a href="/contact" className="hover:text-[var(--fg)]">Contact</a>
          <a href="/legal" className="hover:text-[var(--fg)]">Legal</a>
          <a
            href="https://satelink.network"
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-[var(--fg)] hover:border-[var(--accent)]"
          >
            Satelink ↗
          </a>
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--line)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-8 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Jakuraa. All rights reserved.</p>
        <div className="flex gap-5">
          <a href="https://satelink.network" className="hover:text-[var(--fg)]">Satelink</a>
          <a href="/legal" className="hover:text-[var(--fg)]">Legal</a>
          <a href="/contact" className="hover:text-[var(--fg)]">Contact</a>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <Nav />
        <main className="mx-auto max-w-5xl px-4">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
