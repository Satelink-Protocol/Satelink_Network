"use client";
// Data-driven mega-menu header (§6). Presentational: it takes Navigation data as
// a prop (the app fetches it from the CMS with fallback). Accessible: roving
// focus, Esc closes, aria-expanded, hover-intent 150ms, mobile accordion drawer.
// Structural prop types so @satelink/web-ui stays free of a content dependency;
// @satelink/content's Navigation type satisfies them.
import * as React from "react";
import Link from "next/link";
import { Menu, X, ChevronDown } from "lucide-react";
import { Button } from "../ui/Button";
import { ThemeToggle } from "../ui/ThemeToggle";

export type MMItem = { label: string; href: string; description?: string; badge?: string };
export type MMGroup = { title?: string; items: MMItem[] };
export type MMMenu = { label: string; href?: string; groups: MMGroup[]; featureCard?: { title: string; href: string } };
export type MMCta = { label: string; href: string; variant?: "ghost" | "primary" | "secondary" };
export type MegaNav = { menus: MMMenu[]; cta: MMCta[] };

const HOVER_INTENT_MS = 150;

export function MegaMenuHeader({ nav, brand = "Satelink", search }: { nav: MegaNav; brand?: string; search?: React.ReactNode }) {
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = React.useRef<HTMLElement>(null);

  const clearTimer = () => timer.current && clearTimeout(timer.current);
  const scheduleOpen = (label: string) => {
    clearTimer();
    timer.current = setTimeout(() => setOpenMenu(label), HOVER_INTENT_MS);
  };
  const scheduleClose = () => {
    clearTimer();
    timer.current = setTimeout(() => setOpenMenu(null), HOVER_INTENT_MS);
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-[var(--header-height)] border-b border-sl-border bg-[color-mix(in_srgb,var(--sl-bg)_82%,transparent)] backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-sl-text">
          <span aria-hidden className="flex size-8 items-center justify-center rounded-[var(--sl-radius-sm)] bg-sl-accent font-sl-mono text-base text-sl-accent-ink">S</span>
          <span className="text-[17px]">{brand}</span>
        </Link>

        {/* Desktop menu bar */}
        <nav ref={navRef} className="hidden items-center gap-1 lg:flex" aria-label="Primary" onMouseLeave={scheduleClose}>
          {nav.menus.map((menu) => {
            const isPlain = menu.groups.length === 0 && menu.href;
            if (isPlain) {
              return (
                <Link key={menu.label} href={menu.href!} className="rounded-[var(--sl-radius-sm)] px-3 py-2 text-sm font-medium text-sl-text-muted transition-colors hover:text-sl-text">
                  {menu.label}
                </Link>
              );
            }
            const open = openMenu === menu.label;
            return (
              <div key={menu.label} className="relative" onMouseEnter={() => scheduleOpen(menu.label)}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-haspopup="true"
                  className="inline-flex items-center gap-1 rounded-[var(--sl-radius-sm)] px-3 py-2 text-sm font-medium text-sl-text-muted transition-colors hover:text-sl-text data-[open=true]:text-sl-text"
                  data-open={open}
                  onClick={() => setOpenMenu(open ? null : menu.label)}
                  onFocus={() => setOpenMenu(menu.label)}
                >
                  {menu.label}
                  <ChevronDown className="size-3.5 transition-transform data-[open=true]:rotate-180" data-open={open} />
                </button>
                {open && (
                  <div
                    role="region"
                    aria-label={menu.label}
                    className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-max min-w-[520px] rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 shadow-[var(--sl-shadow-2)]"
                    onMouseEnter={clearTimer}
                  >
                    <div className="flex gap-6">
                      <div className="grid flex-1 grid-cols-2 gap-x-8 gap-y-5">
                        {menu.groups.map((g, gi) => (
                          <div key={g.title ?? gi}>
                            {g.title && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{g.title}</p>}
                            <ul className="space-y-1">
                              {g.items.map((it) => (
                                <li key={it.href}>
                                  <Link href={it.href} className="block rounded-[var(--sl-radius-sm)] px-2 py-1.5 text-sm text-sl-text-muted transition-colors hover:bg-sl-bg hover:text-sl-text" onClick={() => setOpenMenu(null)}>
                                    {it.label}
                                    {it.badge && <span className="ml-2 rounded bg-sl-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-sl-accent">{it.badge}</span>}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      {menu.featureCard && (
                        <Link href={menu.featureCard.href} className="flex w-48 shrink-0 flex-col justify-end rounded-[var(--sl-radius)] border border-sl-border bg-sl-bg p-4 transition-colors hover:border-sl-accent" onClick={() => setOpenMenu(null)}>
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">Featured</span>
                          <span className="mt-1 text-sm font-medium text-sl-text">{menu.featureCard.title}</span>
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-2.5 lg:flex">
          {search}
          <ThemeToggle />
          {nav.cta.map((c) => (
            <Button key={c.label} asChild variant={c.variant ?? "ghost"} size="sm">
              <Link href={c.href}>{c.label}</Link>
            </Button>
          ))}
        </div>

        {/* Mobile toggle */}
        <button
          className="inline-flex size-10 items-center justify-center rounded-[var(--sl-radius-sm)] border border-sl-border text-sl-text-muted lg:hidden"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="max-h-[calc(100vh-var(--header-height))] overflow-y-auto border-b border-sl-border bg-sl-bg px-4 py-3 lg:hidden">
          <ul className="flex flex-col">
            {nav.menus.map((menu) => (
              <li key={menu.label} className="border-b border-sl-border last:border-0">
                {menu.groups.length === 0 && menu.href ? (
                  <Link href={menu.href} className="block min-h-11 py-3 text-base text-sl-text" onClick={() => setMobileOpen(false)}>{menu.label}</Link>
                ) : (
                  <MobileAccordion menu={menu} onNavigate={() => setMobileOpen(false)} />
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <ThemeToggle />
            {nav.cta.map((c) => (
              <Button key={c.label} asChild variant={c.variant ?? "secondary"} size="sm" className="flex-1">
                <Link href={c.href} onClick={() => setMobileOpen(false)}>{c.label}</Link>
              </Button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

function MobileAccordion({ menu, onNavigate }: { menu: MMMenu; onNavigate: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button type="button" aria-expanded={open} className="flex min-h-11 w-full items-center justify-between py-3 text-base text-sl-text" onClick={() => setOpen((o) => !o)}>
        {menu.label}
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="pb-2 pl-3">
          {menu.groups.map((g, gi) => (
            <div key={g.title ?? gi} className="mb-2">
              {g.title && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{g.title}</p>}
              <ul>
                {g.items.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href} className="block py-1.5 text-sm text-sl-text-muted" onClick={onNavigate}>{it.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
