"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { businesses } from "@/content/businesses";
import { StatusBadge } from "./StatusBadge";

const links = [
  { href: "/company", label: "Company" },
  { href: "/technology", label: "Technology" },
  { href: "/news", label: "News" },
  { href: "/careers", label: "Careers" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menu]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="sticky top-0 z-40 border-b border-stone-1 bg-ivory/90 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:bg-ivory focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-serif text-xl tracking-tight" aria-label="Jakuraa — home">
          Jakuraa
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 text-[15px] md:flex">
          <Link href="/company" className={isActive("/company") ? "text-ink" : "text-stone-4 hover:text-ink"}>
            Company
          </Link>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-expanded={menu}
              aria-controls="businesses-menu"
              onClick={() => setMenu((m) => !m)}
              className={`inline-flex items-center gap-1 ${isActive("/businesses") ? "text-ink" : "text-stone-4 hover:text-ink"}`}
            >
              Businesses
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={menu ? "rotate-180" : ""}>
                <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
            {menu && (
              <div
                id="businesses-menu"
                className="absolute left-1/2 top-full mt-4 w-[420px] -translate-x-1/2 rounded-xl border border-stone-1 bg-ivory p-2 shadow-[0_12px_40px_-12px_rgba(21,19,15,0.18)]"
              >
                {businesses.map((b) => (
                  <Link
                    key={b.slug}
                    href={`/businesses/${b.slug}`}
                    className="flex items-start justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-ivory-2"
                  >
                    <span>
                      <span className="block text-ink">{b.short}</span>
                      <span className="block text-sm text-stone-3">{b.summary.split(":")[0].split(",")[0]}</span>
                    </span>
                    <StatusBadge status={b.status} />
                  </Link>
                ))}
                <Link href="/businesses" className="mt-1 block rounded-lg px-3 py-2 text-sm text-green hover:bg-ivory-2">
                  All businesses →
                </Link>
              </div>
            )}
          </div>
          {links.slice(1).map((l) => (
            <Link key={l.href} href={l.href} className={isActive(l.href) ? "text-ink" : "text-stone-4 hover:text-ink"}>
              {l.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          className="-mr-2 inline-flex h-10 w-10 items-center justify-center md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            {open ? (
              <path d="M5 5l12 12M17 5L5 17" stroke="currentColor" strokeWidth="1.5" />
            ) : (
              <path d="M3 7h16M3 15h16" stroke="currentColor" strokeWidth="1.5" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="fixed inset-x-0 bottom-0 top-16 overflow-y-auto bg-ivory px-4 pb-10 pt-4 md:hidden">
          <ul className="divide-y divide-stone-1 font-serif text-2xl">
            <li><Link href="/company" className="block py-4">Company</Link></li>
            <li className="py-4">
              <Link href="/businesses" className="block">Businesses</Link>
              <ul className="mt-3 space-y-3 font-sans text-base">
                {businesses.map((b) => (
                  <li key={b.slug}>
                    <Link href={`/businesses/${b.slug}`} className="flex items-center justify-between gap-3 text-stone-4">
                      {b.short}
                      <StatusBadge status={b.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
            {links.slice(1).map((l) => (
              <li key={l.href}><Link href={l.href} className="block py-4">{l.label}</Link></li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
