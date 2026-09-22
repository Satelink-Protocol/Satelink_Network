// Shared site footer. Legal pages (Terms, Privacy, Refund, Contact) plus the
// legal entity name + registered address are reachable from every page (§2.8).
// The crypto rail (x402/USDT/RPC) is kept visually separate from the Dodo
// product surfaces (§2.2).
import Link from "next/link";
import { Github, Mail } from "lucide-react";

const COLUMNS: { heading: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    heading: "Products",
    links: [
      { href: "/intelligence", label: "Trading Intelligence" },
      { href: "/corporate", label: "Corporate Services" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Machine rail",
    links: [
      { href: "/machine", label: "For Agents (x402)" },
      { href: "/network", label: "Network" },
      { href: "/rpc", label: "RPC Gateway" },
      {
        href: "https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF",
        label: "Vault on Polygonscan",
        external: true,
      },
    ],
  },
  {
    heading: "Developers",
    links: [
      { href: "https://docs.satelink.network", label: "Documentation", external: true },
      { href: "/status", label: "Status" },
      { href: "https://github.com/Satelink-Protocol/x402-kit", label: "x402-kit (GitHub)", external: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/refund", label: "Refund & Cancellation" },
      { href: "/contact", label: "Contact" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-sl-border bg-sl-bg">
      <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.6fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2.5 font-bold text-sl-text">
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-[var(--sl-radius-sm)] bg-sl-accent font-sl-mono text-base text-sl-accent-ink"
              >
                S
              </span>
              <span className="text-[17px]">Satelink</span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
              Machine commerce infrastructure — derived market intelligence and metered data services
              that software agents and companies can buy, call, and settle automatically.
            </p>
            <div className="mt-5 flex gap-2.5">
              <a
                href="https://github.com/Satelink-Protocol/x402-kit"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="inline-flex size-9 items-center justify-center rounded-[var(--sl-radius-sm)] border border-sl-border text-sl-text-muted transition-colors hover:border-sl-border-strong hover:text-sl-text"
              >
                <Github className="size-[18px]" />
              </a>
              <a
                href="mailto:satelinknetwork@gmail.com"
                aria-label="Email"
                className="inline-flex size-9 items-center justify-center rounded-[var(--sl-radius-sm)] border border-sl-border text-sl-text-muted transition-colors hover:border-sl-border-strong hover:text-sl-text"
              >
                <Mail className="size-[18px]" />
              </a>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.08em] text-sl-text-subtle">
                {col.heading}
              </h3>
              <ul className="space-y-3">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    {l.external ? (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-sl-text-muted transition-colors hover:text-sl-accent"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-sm text-sl-text-muted transition-colors hover:text-sl-accent">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-sl-border pt-6 text-sm text-sl-text-muted sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p>&copy; 2026 Jakuraa Commercial Pvt Ltd. All rights reserved.</p>
            <p className="mt-1 text-sl-text-subtle">
              38/39 Malaviya Street, Ram Nagar, Coimbatore 641009, Tamil Nadu, India ·{" "}
              <a href="mailto:satelinknetwork@gmail.com" className="hover:text-sl-accent">
                satelinknetwork@gmail.com
              </a>
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/terms" className="hover:text-sl-accent">Terms</Link>
            <Link href="/privacy" className="hover:text-sl-accent">Privacy</Link>
            <Link href="/refund" className="hover:text-sl-accent">Refund &amp; Cancellation</Link>
            <Link href="/contact" className="hover:text-sl-accent">Contact</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
