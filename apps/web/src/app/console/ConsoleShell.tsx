"use client";
// ConsoleShell (web-v3 P6) — the customer machine-commerce console chrome:
// a left nav (product colours), a top bar with the balance summary, and a
// responsive drawer on mobile. Dark by default (§7.2). Data comes only from
// real endpoints; where an endpoint doesn't exist yet (Track B), pages render
// a designed empty state — never "—".
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, LineChart, CreditCard, Server, KeyRound, BarChart3,
  Receipt, BookOpen, Settings, Menu, X,
} from "lucide-react";

type NavItem = { label: string; href: string; icon: typeof LayoutDashboard; color?: string };
type NavGroup = { title?: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { items: [{ label: "Home", href: "/console", icon: LayoutDashboard }] },
  {
    title: "Products",
    items: [
      { label: "Trading Intelligence", href: "/console/products/trading-intelligence", icon: LineChart, color: "var(--sl-market)" },
      { label: "Machine Payments (x402)", href: "/console/products/x402", icon: CreditCard, color: "var(--sl-machine)" },
      { label: "RPC", href: "/console/products/rpc", icon: Server, color: "var(--sl-settle)" },
    ],
  },
  {
    title: "Manage",
    items: [
      { label: "Agents & keys", href: "/console/agents", icon: KeyRound },
      { label: "Usage", href: "/console/usage", icon: BarChart3 },
      { label: "Billing", href: "/console/billing", icon: Receipt },
      { label: "Docs & SDKs", href: "/console/docs", icon: BookOpen },
      { label: "Settings", href: "/console/settings", icon: Settings },
    ],
  },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-6" aria-label="Console">
      {NAV.map((group, gi) => (
        <div key={gi}>
          {group.title && (
            <p className="mb-2 px-3 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-sl-text-subtle">{group.title}</p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || (item.href !== "/console" && pathname.startsWith(item.href));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-[var(--sl-radius)] px-3 py-2 text-sm transition-colors ${
                      active ? "bg-sl-surface font-semibold text-sl-text" : "text-sl-text-muted hover:bg-sl-surface hover:text-sl-text"
                    }`}
                  >
                    <item.icon className="size-4 shrink-0" style={item.color ? { color: item.color } : undefined} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/console";
  const [open, setOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-sl-bg text-sl-text">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-sl-border bg-sl-bg-raised px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-[var(--sl-radius-sm)] p-1.5 text-sl-text-muted hover:bg-sl-surface lg:hidden"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <Link href="/console" className="font-sl-display text-base font-normal tracking-tight text-sl-text">Satelink</Link>
          <span className="rounded-[var(--sl-radius-pill)] border border-sl-border px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-sl-text-subtle">Console</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-sl-text-muted">
          <span className="hidden sm:inline">Balance</span>
          <span className="font-sl-mono font-semibold text-sl-text">$0.00</span>
          <Link href="/console/billing" className="rounded-[var(--sl-radius-sm)] bg-sl-accent px-2.5 py-1 text-xs font-semibold text-sl-accent-ink">Top up</Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px]">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-r border-sl-border p-4 lg:block">
          <div className="sticky top-[72px]">
            <NavLinks pathname={pathname} />
          </div>
        </aside>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute left-0 top-0 h-full w-72 overflow-y-auto border-r border-sl-border bg-sl-bg-raised p-4">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-sl-display font-normal text-sl-text">Satelink</span>
                <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="rounded-[var(--sl-radius-sm)] p-1.5 text-sl-text-muted hover:bg-sl-surface">
                  <X className="size-5" />
                </button>
              </div>
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
