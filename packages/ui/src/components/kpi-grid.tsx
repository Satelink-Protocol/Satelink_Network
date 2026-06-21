import * as React from "react";

import { cn } from "../lib/utils";

export interface KPIGridProps {
  children: React.ReactNode;
  /** Max columns at the largest breakpoint (2-4). Default 4. */
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * The KPI strip — a responsive grid of StatCards with uniform gaps. Every
 * dashboard's headline metrics row uses this, so density is identical.
 */
export function KPIGrid({ children, columns = 4, className }: KPIGridProps) {
  return (
    <div
      data-slot="kpi-grid"
      className={cn("grid grid-cols-1 gap-3", COLS[columns], className)}
    >
      {children}
    </div>
  );
}
