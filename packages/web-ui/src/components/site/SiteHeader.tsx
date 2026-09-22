"use client";
// Shared site header — machine-commerce nav (§4). Consumes Satelink Signal
// tokens. Primary CTA drives the styled checkout (/checkout?plan=starter).
import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const NAV_LINKS = [
  { href: "/intelligence", label: "Intelligence" },
  { href: "/corporate", label: "Corporate" },
  { href: "/pricing", label: "Pricing" },
  { href: "/machine", label: "For Agents" },
  { href: "https://docs.satelink.network", label: "Docs" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-[var(--header-height)] border-b border-sl-border bg-[color-mix(in_srgb,var(--sl-bg)_82%,transparent)] backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-sl-text">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-[var(--sl-radius-sm)] bg-sl-accent font-sl-mono text-base text-sl-accent-ink"
          >
            S
          </span>
          <span className="text-[17px]">Satelink</span>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-sl-text-muted transition-colors hover:text-sl-text"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 lg:flex">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/satelink/os/mission-control">Log in</Link>
          </Button>
          <Button asChild variant="primary" size="sm">
            <Link href="/checkout?plan=starter">Get started</Link>
          </Button>
        </div>

        <button
          className="inline-flex size-10 items-center justify-center rounded-[var(--sl-radius-sm)] border border-sl-border text-sl-text-muted lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open && (
        <nav
          className="flex flex-col gap-1 border-b border-sl-border bg-sl-bg px-4 py-3 lg:hidden"
          aria-label="Mobile"
        >
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="min-h-11 border-b border-sl-border py-2.5 text-base text-sl-text last:border-0"
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-3 flex items-center gap-2.5">
            <ThemeToggle />
            <Button asChild variant="secondary" size="sm" className="flex-1">
              <Link href="/satelink/os/mission-control">Log in</Link>
            </Button>
            <Button asChild variant="primary" size="sm" className="flex-1">
              <Link href="/checkout?plan=starter">Get started</Link>
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
