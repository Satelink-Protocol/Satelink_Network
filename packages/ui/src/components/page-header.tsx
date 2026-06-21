import * as React from "react";

import { cn } from "../lib/utils";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumb?: string[];
  /** Right-aligned actions (buttons, selectors). */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Canonical page header. Every OS page renders exactly one — identical
 * breadcrumb / title / subtitle structure and spacing.
 */
export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="space-y-1">
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={`${crumb}-${i}`}>
                {i > 0 ? <span className="text-muted-foreground/50">/</span> : null}
                <span className={i === breadcrumb.length - 1 ? "text-foreground/70" : undefined}>
                  {crumb}
                </span>
              </React.Fragment>
            ))}
          </nav>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
