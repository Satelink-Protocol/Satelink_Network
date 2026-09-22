// apps/web/src/components/site/SiteHeader.tsx
//
// Shared header for the standalone marketing/product/legal pages under
// app/(marketing)/ — extracted from the homepage's own <header> (app/page.tsx)
// so every public page uses the same nav, logo, and theme toggle instead of
// each shipping its own ad-hoc chrome (or none at all).
"use client";

import { useState } from "react";

const NAV_LINKS = [
  { href: "/intelligence", label: "Intelligence" },
  { href: "/pricing", label: "Pricing" },
  { href: "/node", label: "Node Operators" },
  { href: "/docs", label: "Docs" },
  { href: "/status", label: "Status" },
];

function toggleTheme() {
  const next =
    document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("satelink-theme", next);
  } catch {
    // private browsing / blocked storage — theme just won't persist
  }
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="header">
      <div className="header-inner">
        <a href="/" className="logo">
          <div className="logo-icon">S</div>
          <span>Satelink</span>
        </a>

        <nav className="nav">
          <ul className="nav-links">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="nav-link">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="nav-actions">
          <button className="theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
            <svg className="sun" viewBox="0 0 24 24" fill="none" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            <svg className="moon" viewBox="0 0 24 24" fill="none" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          </button>
          <a href="/satelink/os/mission-control" className="btn btn-ghost">
            Login
          </a>
          <a href="/satelink/os/keys" className="btn btn-primary">
            Get API Key
          </a>
        </div>

        <button
          className="mobile-menu-btn"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobileNav"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? (
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          )}
        </button>
      </div>

      {menuOpen && (
        <nav id="mobileNav" className="mobile-nav" aria-label="Mobile">
          {[...NAV_LINKS, { href: "/satelink/os/mission-control", label: "Login" }, { href: "/satelink/os/keys", label: "Get API Key" }].map(
            (l) => (
              <a
                key={l.href}
                href={l.href}
                className="mobile-nav-link"
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </a>
            )
          )}
        </nav>
      )}
    </header>
  );
}
