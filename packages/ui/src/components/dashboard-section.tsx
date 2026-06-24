import * as React from "react";

import { cn } from "../lib/utils";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "./ui/card";

export interface DashboardSectionProps {
  title: string;
  description?: string;
  /** Right-aligned toolbar (tabs, selectors, buttons). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /**
   * When true (default) the section is a Card. Set false for a bare titled
   * region (e.g. a grid of its own cards).
   */
  card?: boolean;
  /** Remove content padding (e.g. a full-bleed DataTable). */
  flush?: boolean;
  className?: string;
}

/**
 * A titled dashboard region with a consistent header (title / description /
 * actions). The structural unit every page is built from — guarantees
 * identical section spacing and typography across OS and Admin.
 */
export function DashboardSection({
  title,
  description,
  actions,
  children,
  card = true,
  flush = false,
  className,
}: DashboardSectionProps) {
  if (!card) {
    return (
      <section data-slot="dashboard-section" className={cn("space-y-4", className)}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </section>
    );
  }

  return (
    <Card data-slot="dashboard-section" className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {actions ? <CardAction>{actions}</CardAction> : null}
      </CardHeader>
      <CardContent className={cn(flush && "px-0")}>{children}</CardContent>
    </Card>
  );
}
