// (checkout) route group — minimal, distraction-free chrome for the payment
// flow. All routes are noindex (§7). A slim header (logo + secure badge) and a
// legal-only footer keep Terms/Refund/Contact reachable without the full nav.
import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-sl-bg text-sl-text">
      <header className="border-b border-sl-border">
        <div className="mx-auto flex h-[var(--header-height)] max-w-[1100px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-sl-text">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-[var(--sl-radius-sm)] bg-sl-accent font-sl-mono text-base text-sl-accent-ink"
            >
              S
            </span>
            <span className="text-[17px]">Satelink</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sl-text-subtle">
            <Lock className="size-3.5" /> Secure checkout
          </span>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-sl-border">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-2 px-4 py-6 text-xs text-sl-text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Jakuraa Commercial Pvt Ltd · Coimbatore, Tamil Nadu, India</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/terms" className="hover:text-sl-accent">Terms</Link>
            <Link href="/refund" className="hover:text-sl-accent">Refund &amp; Cancellation</Link>
            <Link href="/privacy" className="hover:text-sl-accent">Privacy</Link>
            <Link href="/contact" className="hover:text-sl-accent">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
