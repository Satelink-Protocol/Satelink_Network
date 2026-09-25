"use client";
// Data-driven header, claude.com pattern (unified system, 2026-09-25).
//   wordmark · menus ………………… [search][theme] · Log in · <one primary>
// Desktop menus are disclosure buttons that open a SOLID full-width sheet
// (bg-sl-surface + shadow-3) over a dimmed, blurred backdrop, so page content
// underneath is never legible through or beside it (AUDIT_2026-09-25 D1).
// Stacking comes from one scale: --sl-z-header < backdrop < menu < dialog.
// Keyboard: Enter/Space/ArrowDown open, Esc closes and returns focus to the
// trigger, focus leaving the menu closes it. Mobile: a full-screen drawer with
// a focus trap and body scroll lock.
// Structural prop types keep @satelink/web-ui free of a content dependency;
// @satelink/content's Navigation type satisfies them.
import * as React from "react";
import Link from "next/link";
import { Menu, X, ChevronDown, ArrowRight } from "lucide-react";
import { Button } from "../ui/Button";
import { ThemeToggle } from "../ui/ThemeToggle";
import { Wordmark } from "./Wordmark";

export type MMItem = { label: string; href: string; description?: string; badge?: string };
export type MMGroup = { title?: string; items: MMItem[] };
export type MMFeature = { title: string; href: string; description?: string; eyebrow?: string };
export type MMMenu = { label: string; href?: string; groups: MMGroup[]; featureCard?: MMFeature };
export type MMCta = { label: string; href: string; variant?: "ghost" | "primary" | "secondary" };
export type MegaNav = { menus: MMMenu[]; cta: MMCta[] };

const HOVER_INTENT_MS = 120;

const isExternal = (href: string) => /^https?:\/\//.test(href);

function NavLink({ href, className, children, onClick }: { href: string; className?: string; children: React.ReactNode; onClick?: () => void }) {
  // Cross-origin targets (console, docs) are plain anchors: next/link would try
  // to prefetch them as app routes.
  if (isExternal(href)) return <a href={href} className={className} onClick={onClick}>{children}</a>;
  return <Link href={href} className={className} onClick={onClick}>{children}</Link>;
}

export function MegaMenuHeader({ nav, brand = "Satelink", search }: { nav: MegaNav; brand?: string; search?: React.ReactNode }) {
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggers = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const primary = nav.cta.find((c) => c.variant === "primary");
  const secondary = nav.cta.filter((c) => c !== primary);

  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); };
  const scheduleOpen = (label: string) => { clearTimer(); timer.current = setTimeout(() => setOpenMenu(label), HOVER_INTENT_MS); };
  const scheduleClose = () => { clearTimer(); timer.current = setTimeout(() => setOpenMenu(null), HOVER_INTENT_MS); };
  const close = (returnFocus = false) => {
    const label = openMenu;
    setOpenMenu(null);
    if (returnFocus && label) triggers.current[label]?.focus();
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openMenu) close(true);
      setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  React.useEffect(() => () => clearTimer(), []);

  return (
    <>
      <header
        data-sl-header
        className="fixed inset-x-0 top-0 z-[var(--sl-z-header)] h-[var(--header-height)] border-b border-sl-border bg-sl-bg"
      >
        <div className="mx-auto flex h-full max-w-[1200px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label={`${brand} home`} className="shrink-0 text-sl-text">
            <Wordmark name={brand} />
          </Link>

          <nav className="hidden flex-1 items-center gap-0.5 lg:flex" aria-label="Primary" onMouseLeave={scheduleClose}>
            {nav.menus.map((menu) => {
              if (menu.groups.length === 0 && menu.href) {
                return (
                  <NavLink key={menu.label} href={menu.href} className="rounded-[var(--sl-radius-sm)] px-3 py-2 text-sm text-sl-text-muted transition-colors hover:text-sl-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45">
                    {menu.label}
                  </NavLink>
                );
              }
              const open = openMenu === menu.label;
              const panelId = `mm-${menu.label.toLowerCase().replace(/\W+/g, "-")}`;
              return (
                <div
                  key={menu.label}
                  onMouseEnter={() => scheduleOpen(menu.label)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpenMenu((m) => (m === menu.label ? null : m));
                  }}
                >
                  <button
                    ref={(el) => { triggers.current[menu.label] = el; }}
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    data-open={open}
                    className="inline-flex items-center gap-1 rounded-[var(--sl-radius-sm)] px-3 py-2 text-sm text-sl-text-muted transition-colors hover:text-sl-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45 data-[open=true]:text-sl-text"
                    onClick={() => setOpenMenu(open ? null : menu.label)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setOpenMenu(menu.label);
                        requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${panelId} a`)?.focus());
                      }
                    }}
                  >
                    {menu.label}
                    <ChevronDown aria-hidden className={`size-3.5 transition-transform duration-[var(--sl-dur-1)] ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && <MenuSheet id={panelId} menu={menu} onEnter={clearTimer} onNavigate={() => close()} />}
                </div>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {/* Compact icon cluster. `search` renders exactly once (it owns the
                global ⌘K listener). */}
            <div className="flex items-center gap-0.5 lg:pr-2" aria-label="Site tools" role="group">
              {search}
              <ThemeToggle className="hidden lg:inline-flex" />
            </div>
            {secondary.map((c) => (
              <Button key={c.label} asChild variant="ghost" size="sm" className="hidden lg:inline-flex">
                <NavLink href={c.href}>{c.label}</NavLink>
              </Button>
            ))}
            {primary && (
              <Button asChild variant="primary" size="sm" className="ml-1 hidden lg:inline-flex">
                <NavLink href={primary.href}>{primary.label}</NavLink>
              </Button>
            )}
            <button
              className="inline-flex size-10 items-center justify-center rounded-[var(--sl-radius-sm)] text-sl-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45 lg:hidden"
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              aria-controls="mm-drawer"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {openMenu && (
        <div
          aria-hidden
          data-sl-backdrop
          className="fixed inset-x-0 bottom-0 top-[var(--header-height)] z-[var(--sl-z-backdrop)] hidden bg-[color-mix(in_srgb,var(--sl-bg)_70%,transparent)] backdrop-blur-[6px] lg:block"
          onMouseEnter={scheduleClose}
          onClick={() => close()}
        />
      )}

      {mobileOpen && <MobileDrawer nav={nav} brand={brand} onClose={() => setMobileOpen(false)} />}
    </>
  );
}

function MenuSheet({ id, menu, onEnter, onNavigate }: { id: string; menu: MMMenu; onEnter: () => void; onNavigate: () => void }) {
  return (
    <div
      id={id}
      role="region"
      aria-label={menu.label}
      data-sl-menu
      onMouseEnter={onEnter}
      className="fixed inset-x-0 top-[var(--header-height)] z-[var(--sl-z-menu)] border-b border-sl-border bg-sl-surface shadow-[var(--sl-shadow-3)] motion-safe:animate-[sl-sheet-in_var(--sl-dur-2)_var(--sl-ease-out)]"
    >
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-8" style={{ gridTemplateColumns: `repeat(${menu.groups.length}, minmax(0, 1fr))${menu.featureCard ? " minmax(240px, 300px)" : ""}` }}>
        {menu.groups.map((g, gi) => (
          <div key={g.title ?? gi}>
            {g.title && <p className="mb-3 text-xs font-medium text-sl-text-subtle">{g.title}</p>}
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.href + it.label}>
                  <NavLink
                    href={it.href}
                    onClick={onNavigate}
                    className="group -mx-2 block rounded-[var(--sl-radius-sm)] px-2 py-1.5 transition-colors hover:bg-sl-surface-hover focus-visible:bg-sl-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45"
                  >
                    <span className="text-[15px] text-sl-text">{it.label}</span>
                    {it.badge && <span className="ml-2 rounded bg-sl-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-sl-accent">{it.badge}</span>}
                    {it.description && <span className="mt-0.5 block text-[13px] leading-snug text-sl-text-muted">{it.description}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {menu.featureCard && (
          <NavLink
            href={menu.featureCard.href}
            onClick={onNavigate}
            className="group flex flex-col justify-between rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-bg p-5 transition-colors hover:border-sl-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45"
          >
            <span className="text-xs font-medium text-sl-text-subtle">{menu.featureCard.eyebrow ?? "Featured"}</span>
            <span className="mt-6">
              <span className="block font-sl-display text-[22px] leading-tight text-sl-text">{menu.featureCard.title}</span>
              {menu.featureCard.description && <span className="mt-1.5 block text-[13px] leading-snug text-sl-text-muted">{menu.featureCard.description}</span>}
              <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-sl-accent">
                Learn more <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </span>
          </NavLink>
        )}
      </div>
    </div>
  );
}

function MobileDrawer({ nav, brand, onClose }: { nav: MegaNav; brand: string; onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, []);

  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const f = [...ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div
      id="mm-drawer"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      onKeyDown={trap}
      className="fixed inset-0 z-[var(--sl-z-dialog)] flex flex-col bg-sl-bg lg:hidden"
    >
      <div className="flex h-[var(--header-height)] shrink-0 items-center justify-between border-b border-sl-border px-4">
        <Link href="/" onClick={onClose} className="text-sl-text" aria-label={`${brand} home`}><Wordmark name={brand} /></Link>
        <button className="inline-flex size-10 items-center justify-center rounded-[var(--sl-radius-sm)] text-sl-text" aria-label="Close menu" onClick={onClose}>
          <X className="size-5" />
        </button>
      </div>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-4">
        <ul>
          {nav.menus.map((menu) => (
            <li key={menu.label} className="border-b border-sl-border">
              {menu.groups.length === 0 && menu.href ? (
                <NavLink href={menu.href} onClick={onClose} className="flex min-h-14 items-center text-lg text-sl-text">{menu.label}</NavLink>
              ) : (
                <MobileAccordion menu={menu} onNavigate={onClose} />
              )}
            </li>
          ))}
        </ul>
      </nav>
      <div className="shrink-0 space-y-2 border-t border-sl-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {[...nav.cta].reverse().map((c) => (
          <Button key={c.label} asChild variant={c.variant === "primary" ? "primary" : "secondary"} size="lg" className="w-full">
            <NavLink href={c.href} onClick={onClose}>{c.label}</NavLink>
          </Button>
        ))}
        <div className="flex items-center justify-between pt-2 text-sm text-sl-text-muted">
          <span>Theme</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function MobileAccordion({ menu, onNavigate }: { menu: MMMenu; onNavigate: () => void }) {
  const [open, setOpen] = React.useState(false);
  const id = `mma-${menu.label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={id} className="flex min-h-14 w-full items-center justify-between text-lg text-sl-text" onClick={() => setOpen((o) => !o)}>
        {menu.label}
        <ChevronDown aria-hidden className={`size-5 text-sl-text-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={id} className="pb-4">
          {menu.groups.map((g, gi) => (
            <div key={g.title ?? gi} className="mb-3">
              {g.title && <p className="mb-1 text-xs font-medium text-sl-text-subtle">{g.title}</p>}
              <ul>
                {g.items.map((it) => (
                  <li key={it.href + it.label}>
                    <NavLink href={it.href} onClick={onNavigate} className="flex min-h-11 items-center text-[15px] text-sl-text-muted">{it.label}</NavLink>
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
