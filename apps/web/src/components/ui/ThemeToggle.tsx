"use client";
// ThemeToggle — flips data-theme on <html> and persists to localStorage under
// the same key the pre-paint init script in app/layout.tsx reads
// ("satelink-theme"). Wrapped in try/catch (private browsing / blocked
// storage). Renders the correct icon after mount to avoid hydration mismatch.
import * as React from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "satelink-theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked — theme just won't persist */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={
        "inline-flex size-9 items-center justify-center rounded-[var(--sl-radius-sm)] border border-sl-border text-sl-text-muted transition-colors hover:bg-sl-surface hover:text-sl-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45 " +
        (className ?? "")
      }
    >
      {mounted && theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}
