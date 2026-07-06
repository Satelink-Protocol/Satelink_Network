"use client";

import * as React from "react";
import { CopyIcon, CheckIcon } from "lucide-react";
import { cn } from "../lib/utils";

export interface CopyFieldProps {
  /** Full machine value (address, tx hash, API key, URL). */
  value: string;
  /** Optional label rendered above the field. */
  label?: React.ReactNode;
  /**
   * Middle-truncate for display: `0x577D…aCEF`. Defaults to true for values
   * longer than 20 chars. The full value is always what gets copied.
   */
  truncate?: boolean;
  /** Chars kept on each side when truncating. */
  edge?: number;
  /** Mask all but the edges (API keys). Copy still copies the full value. */
  mask?: boolean;
  className?: string;
}

function truncateMiddle(v: string, edge: number): string {
  if (v.length <= edge * 2 + 1) return v;
  return `${v.slice(0, edge)}…${v.slice(-edge)}`;
}

/**
 * CopyField — machine values (addresses, hashes, keys) with one-tap copy.
 * Mono by design-system rule: monospace is reserved for machine truth.
 */
export function CopyField({
  value,
  label,
  truncate,
  edge = 6,
  mask = false,
  className,
}: CopyFieldProps) {
  const [copied, setCopied] = React.useState(false);
  const shouldTruncate = truncate ?? value.length > 20;
  const shown = mask
    ? `${value.slice(0, 8)}${"•".repeat(6)}${value.slice(-4)}`
    : shouldTruncate
      ? truncateMiddle(value, edge)
      : value;

  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      ) : null}
      <div
        className="flex items-center gap-2 rounded-md border px-3 py-2"
        style={{
          backgroundColor: "hsl(var(--elevated, var(--muted)))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <code
          className="numeric min-w-0 flex-1 truncate font-mono text-xs text-foreground"
          title={mask ? undefined : value}
        >
          {shown}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy value"}
          className="shrink-0 rounded p-1 text-muted-foreground transition-tokens hover:text-foreground focus-visible:outline-2"
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-state-healthy" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
