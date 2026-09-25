"use client";
// ⌘K search palette (§14). Presentational + keyboard; the app supplies a search
// function (Postgres FTS route). Opens on ⌘K / Ctrl-K or the trigger; Esc closes;
// arrow keys move; Enter navigates. Results are grouped by content type.
import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export type SearchHit = { title: string; href: string; type: string; excerpt?: string };
export type SearchFn = (q: string) => Promise<SearchHit[]>;

export function SearchPalette({ search, placeholder = "Search Satelink…" }: { search: SearchFn; placeholder?: string }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [active, setActive] = React.useState(0);
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
    else {
      setQ("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  React.useEffect(() => {
    let cancelled = false;
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await search(q);
        if (!cancelled) {
          setHits(r);
          setActive(0);
        }
      } catch {
        if (!cancelled) setHits([]);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, search]);

  const go = (h: SearchHit) => {
    setOpen(false);
    router.push(h.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Search (⌘K)"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
        className="inline-flex size-9 items-center justify-center rounded-[var(--sl-radius-sm)] text-sl-text-muted transition-colors hover:bg-sl-surface-hover hover:text-sl-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45"
      >
        <Search className="size-[18px]" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[var(--sl-z-dialog)] flex items-start justify-center bg-[color-mix(in_srgb,var(--sl-bg)_60%,black_25%)] p-4 pt-[12vh] backdrop-blur-[6px]" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface shadow-[var(--sl-shadow-3)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-sl-border px-4">
              <Search className="size-4 text-sl-text-subtle" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                aria-label="Search query"
                className="h-12 w-full bg-transparent text-sm text-sl-text outline-none placeholder:text-sl-text-subtle"
              />
            </div>
            <ul className="max-h-80 overflow-y-auto p-2">
              {hits.length === 0 && q.trim() && <li className="px-3 py-6 text-center text-sm text-sl-text-subtle">No results</li>}
              {hits.map((h, i) => (
                <li key={h.href}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                    aria-selected={i === active}
                    className="flex w-full flex-col items-start rounded-[var(--sl-radius-sm)] px-3 py-2 text-left aria-selected:bg-sl-bg"
                  >
                    <span className="flex items-center gap-2 text-sm text-sl-text">
                      {h.title}
                      <span className="rounded bg-sl-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sl-text-subtle">{h.type}</span>
                    </span>
                    {h.excerpt && <span className="mt-0.5 line-clamp-1 text-xs text-sl-text-subtle">{h.excerpt}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
