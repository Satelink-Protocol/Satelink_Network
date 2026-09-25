"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, BarChart3, Bell, Bot, CreditCard, Home, KeyRound, LayoutDashboard, LineChart, Menu, MoreHorizontal, Moon, Search,
  Server, Settings, Sun, Wallet, X, Zap,
} from "lucide-react";

type NavItem = { href: string; label: string; key: string; icon: React.ComponentType<{ className?: string }>; group?: string };

export const NAV: NavItem[] = [
  { href: "/", label: "Overview", key: "o", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", key: "a", icon: Bot },
  { href: "/keys", label: "API keys", key: "k", icon: KeyRound },
  { href: "/requests", label: "Requests", key: "r", icon: Activity },
  { href: "/usage", label: "Usage", key: "u", icon: BarChart3 },
  { href: "/trading-intelligence", label: "Trading Intel", key: "t", icon: LineChart, group: "Products" },
  { href: "/rpc", label: "RPC", key: "p", icon: Server, group: "Products" },
  { href: "/x402", label: "x402", key: "x", icon: Zap, group: "Products" },
  { href: "/billing", label: "Billing", key: "b", icon: CreditCard, group: "Account" },
  { href: "/alerts", label: "Alerts", key: "l", icon: Bell, group: "Account" },
  { href: "/settings", label: "Settings", key: "s", icon: Settings, group: "Account" },
];

// Console V2 (account mode): Simple mode is task-first; Advanced keeps the
// analytics pages. The bottom tab bar is the mobile navigation in both.
export const SIMPLE_NAV: NavItem[] = [
  { href: "/", label: "Home", key: "h", icon: Home },
  { href: "/data", label: "Get market data", key: "d", icon: LineChart },
  { href: "/agents", label: "Agents & keys", key: "a", icon: Bot },
  { href: "/billing", label: "Billing", key: "b", icon: CreditCard },
  { href: "/spend", label: "Spending", key: "p", icon: Wallet },
  { href: "/settings", label: "Settings", key: "s", icon: Settings },
];
export const ADVANCED_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", key: "o", icon: LayoutDashboard },
  { href: "/data", label: "Market data", key: "d", icon: LineChart },
  { href: "/agents", label: "Agents", key: "a", icon: Bot },
  { href: "/keys", label: "API keys", key: "k", icon: KeyRound },
  { href: "/requests", label: "Requests", key: "r", icon: Activity },
  { href: "/usage", label: "Usage", key: "u", icon: BarChart3 },
  { href: "/rpc", label: "RPC", key: "c", icon: Server, group: "Products" },
  { href: "/x402", label: "x402", key: "x", icon: Zap, group: "Products" },
  { href: "/billing", label: "Billing", key: "b", icon: CreditCard, group: "Account" },
  { href: "/spend", label: "Spending", key: "p", icon: Wallet, group: "Account" },
  { href: "/alerts", label: "Alerts", key: "l", icon: Bell, group: "Account" },
  { href: "/settings", label: "Settings", key: "s", icon: Settings, group: "Account" },
];
const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/data", label: "Data", icon: LineChart },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

type Props = {
  mode?: "simple" | "advanced" | null;
  user: { name: string; email: string };
  keys: { fp: string; label: string }[];
  activeFp: string | null;
  theme: "dark" | "light";
  children: React.ReactNode;
};

export function Shell({ mode = null, user, keys, activeFp, theme: initialTheme, children }: Props) {
  const nav = mode === "simple" ? SIMPLE_NAV : mode === "advanced" ? ADVANCED_NAV : NAV;
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState(initialTheme);
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const gPending = useRef<number | null>(null);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `slc_theme=${next}; path=/; max-age=31536000; samesite=strict${location.protocol === "https:" ? "; secure" : ""}`;
  }, [theme]);

  const signOut = useCallback(async () => {
    await fetch("/api/identity/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
    router.push("/sign-in");
    router.refresh();
  }, [router]);

  const switchKey = async (fp: string) => {
    await fetch("/api/console/keys/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fp }) });
    router.refresh();
  };

  useEffect(() => setDrawer(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (gPending.current !== null) {
        const item = nav.find((n) => n.key === e.key.toLowerCase());
        window.clearTimeout(gPending.current);
        gPending.current = null;
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (e.key === "g") gPending.current = window.setTimeout(() => (gPending.current = null), 1200);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, nav]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const groups = ["", "Products", "Account"];

  const sidebar = (
    <nav aria-label="Console" className="flex h-full flex-col gap-4 overflow-y-auto p-2">
      {groups.filter((g) => nav.some((n) => (n.group || "") === g)).map((g) => (
        <ul key={g || "main"} className="space-y-px">
          {g && <li className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-sl-text-subtle">{g}</li>}
          {nav.filter((n) => (n.group || "") === g).map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={`group flex items-center gap-2 rounded px-2 py-1.5 ${isActive(n.href) ? "bg-sl-surface-hover text-sl-text" : "text-sl-text-muted hover:bg-sl-surface-hover hover:text-sl-text"}`}
              >
                <n.icon className="size-4 shrink-0" />
                <span className="flex-1">{n.label}</span>
                <kbd className="hidden font-mono text-[10px] text-sl-text-subtle group-hover:inline">g {n.key}</kbd>
              </Link>
            </li>
          ))}
        </ul>
      ))}
      <div className="mt-auto border-t border-sl-border px-2 pt-3 text-[11px] text-sl-text-subtle">
        <p className="truncate text-sl-text-muted">{user.name || user.email}</p>
        <p className="truncate">{user.email}</p>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-sl-border bg-sl-bg-raised px-2 sm:px-3">
        <button type="button" className="inline-flex size-8 items-center justify-center rounded md:hidden" aria-label={drawer ? "Close navigation" : "Open navigation"} aria-expanded={drawer} onClick={() => setDrawer((d) => !d)}>
          {drawer ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="inline-block size-2.5 rounded-sm bg-sl-accent" />
          Satelink <span className="font-normal text-sl-text-subtle">Console</span>
        </Link>
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="ml-2 hidden h-7 flex-1 items-center gap-2 rounded border border-sl-border bg-sl-surface px-2 text-left text-sl-text-subtle hover:border-sl-border-strong sm:flex sm:max-w-xs"
        >
          <Search className="size-3.5" /> <span className="flex-1">Search or jump to…</span>
          <kbd className="font-mono text-[10px]">⌘K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {mode && <ModeToggle mode={mode} />}
          {!mode && keys.length > 0 && (
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Active API key</span>
              <KeyRound className="hidden size-3.5 text-sl-text-subtle sm:block" />
              <select
                value={activeFp || ""}
                onChange={(e) => switchKey(e.target.value)}
                className="h-7 max-w-[9.5rem] rounded border border-sl-border bg-sl-surface px-1.5 font-mono text-[11px] text-sl-text sm:max-w-[14rem]"
              >
                {keys.map((k) => (
                  <option key={k.fp} value={k.fp}>{k.label} · {k.fp}</option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} className="inline-flex size-7 items-center justify-center rounded border border-sl-border hover:border-sl-border-strong">
            {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="sticky top-11 hidden h-[calc(100vh-2.75rem)] w-52 shrink-0 border-r border-sl-border bg-sl-bg-raised md:block">{sidebar}</aside>
        {drawer && <div className="fixed inset-0 top-11 z-20 bg-sl-bg-raised md:hidden">{sidebar}</div>}
        <main id="main" className={`min-w-0 flex-1 px-3 py-4 sm:px-5 ${mode ? "pb-24 md:pb-4" : ""}`}>{children}</main>
      </div>

      {mode && (
        <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-sl-border bg-sl-bg-raised pb-[env(safe-area-inset-bottom)] md:hidden">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={isActive(t.href) ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive(t.href) ? "text-sl-accent" : "text-sl-text-muted"}`}>
              <t.icon aria-hidden className="size-5" />{t.label}
            </Link>
          ))}
          <button type="button" onClick={() => setDrawer(true)} aria-expanded={drawer} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-sl-text-muted">
            <MoreHorizontal aria-hidden className="size-5" />More
          </button>
        </nav>
      )}

      {palette && (
        <CommandPalette
          onClose={() => setPalette(false)}
          actions={[
            ...nav.map((n) => ({ id: n.href, label: `Go to ${n.label}`, hint: `g ${n.key}`, run: () => router.push(n.href) })),
            { id: "new-key", label: "Create an API key", hint: "", run: () => router.push("/keys?new=1") },
            { id: "theme", label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`, hint: "", run: toggleTheme },
            { id: "docs", label: "Open API docs", hint: "", run: () => window.open("https://satelink.network/docs", "_blank", "noopener") },
            { id: "signout", label: "Sign out", hint: "", run: signOut },
          ]}
        />
      )}
    </div>
  );
}

function CommandPalette({ actions, onClose }: { actions: { id: string; label: string; hint: string; run: () => void }[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const filtered = useMemo(() => actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())), [actions, q]);
  useEffect(() => setI(0), [q]);
  const run = (idx: number) => {
    const a = filtered[idx];
    if (!a) return;
    onClose();
    a.run();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 pt-[12vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-lg overflow-hidden rounded-md border border-sl-border bg-sl-surface shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-sl-border px-3">
          <Search className="size-4 text-sl-text-subtle" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
              if (e.key === "Enter") run(i);
            }}
            placeholder="Type a command or page…"
            aria-label="Command"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={filtered[i] ? `pal-${filtered[i].id}` : undefined}
            className="h-10 flex-1 bg-transparent text-sm text-sl-text outline-none placeholder:text-sl-text-subtle"
          />
          <kbd className="font-mono text-[10px] text-sl-text-subtle">esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 && <li className="px-3 py-2 text-sl-text-subtle">No matches</li>}
          {filtered.map((a, idx) => (
            <li
              key={a.id}
              id={`pal-${a.id}`}
              role="option"
              aria-selected={idx === i}
              onMouseEnter={() => setI(idx)}
              onClick={() => run(idx)}
              className={`flex cursor-pointer items-center justify-between rounded px-3 py-1.5 ${idx === i ? "bg-sl-surface-hover text-sl-text" : "text-sl-text-muted"}`}
            >
              {a.label}
              {a.hint && <kbd className="font-mono text-[10px] text-sl-text-subtle">{a.hint}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ModeToggle({ mode }: { mode: "simple" | "advanced" }) {
  const router = useRouter();
  const set = async (m: "simple" | "advanced") => {
    if (m === mode) return;
    document.cookie = `slc_mode=${m}; path=/; max-age=31536000; samesite=strict${location.protocol === "https:" ? "; secure" : ""}`;
    // Remembered per account (server-side), so every browser opens in it.
    await fetch("/api/console/me/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultMode: m }) }).catch(() => undefined);
    router.refresh();
  };
  return (
    <div role="radiogroup" aria-label="Console mode" className="flex rounded-[var(--sl-radius-sm)] border border-sl-border p-0.5 text-[12px]">
      {(["simple", "advanced"] as const).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => set(m)}
          className={`rounded-[4px] px-2 py-0.5 capitalize ${mode === m ? "bg-sl-surface-hover text-sl-text" : "text-sl-text-muted hover:text-sl-text"}`}>
          {m}
        </button>
      ))}
    </div>
  );
}
