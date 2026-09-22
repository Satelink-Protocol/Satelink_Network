"use client";
// CodeBlock — code sample with a copy button and optional language tabs
// (curl / TS / Python). Pass a single `code` string, or `tabs` for the
// multi-language variant. Copy is clipboard-guarded (try/catch).
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/utils";

export interface CodeTab {
  label: string;
  code: string;
}

export interface CodeBlockProps {
  code?: string;
  tabs?: CodeTab[];
  className?: string;
  ariaLabel?: string;
}

export function CodeBlock({ code, tabs, className, ariaLabel }: CodeBlockProps) {
  const resolved: CodeTab[] = tabs ?? (code ? [{ label: "shell", code }] : []);
  const [active, setActive] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const current = resolved[active] ?? { label: "", code: "" };

  async function copy() {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--sl-radius)] border border-sl-border bg-sl-bg-raised",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-sl-border px-2 py-1.5">
        <div className="flex gap-1" role="tablist" aria-label="Language">
          {resolved.length > 1 &&
            resolved.map((t, i) => (
              <button
                key={t.label}
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={cn(
                  "rounded-[var(--sl-radius-sm)] px-2.5 py-1 text-xs font-medium transition-colors",
                  i === active
                    ? "bg-sl-surface text-sl-text"
                    : "text-sl-text-subtle hover:text-sl-text-muted"
                )}
              >
                {t.label}
              </button>
            ))}
        </div>
        <button
          onClick={copy}
          aria-label="Copy code"
          className="inline-flex items-center gap-1.5 rounded-[var(--sl-radius-sm)] px-2 py-1 text-xs font-medium text-sl-text-subtle transition-colors hover:bg-sl-surface hover:text-sl-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45"
        >
          {copied ? <Check className="size-3.5 text-sl-up" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        aria-label={ariaLabel}
        className="overflow-x-auto px-4 py-3.5 font-sl-mono text-[0.8125rem] leading-relaxed text-sl-text"
      >
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
