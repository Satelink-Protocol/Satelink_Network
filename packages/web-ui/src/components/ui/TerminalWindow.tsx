// TerminalWindow — macOS-style window chrome for code/terminal content.
// The three traffic-light dot colors are the ONLY hardcoded hex allowed
// outside tokens.css (§5.4 allowlist keys on this filename). Kept local as
// constants rather than tokens because they are a literal skeuomorph, not
// part of the brand palette.
import * as React from "react";
import { cn } from "../../lib/utils";

const DOT = {
  red: "#FF5F56",
  yellow: "#FFBD2E",
  green: "#27CA41",
} as const;

export interface TerminalWindowProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export function TerminalWindow({ title, className, children, ...props }: TerminalWindowProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-bg-raised",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2 border-b border-sl-border px-4 py-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-3 rounded-full" style={{ background: DOT.red }} />
          <span className="size-3 rounded-full" style={{ background: DOT.yellow }} />
          <span className="size-3 rounded-full" style={{ background: DOT.green }} />
        </span>
        {title && (
          <span className="flex-1 text-center font-sl-mono text-xs text-sl-text-subtle">{title}</span>
        )}
      </div>
      <div className="overflow-x-auto p-4 font-sl-mono text-[0.8125rem] leading-relaxed text-sl-text">
        {children}
      </div>
    </div>
  );
}
