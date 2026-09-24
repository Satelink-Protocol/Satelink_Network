// Icon — thin wrapper over lucide-react so pages never reach for emoji as
// icons (§5.2). Pass a lucide icon component as `as`. Default size 1em so it
// scales with surrounding text; override with className.
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IconProps extends React.SVGAttributes<SVGElement> {
  as: LucideIcon;
  className?: string;
}

export function Icon({ as: Cmp, className, ...props }: IconProps) {
  return <Cmp aria-hidden className={cn("size-[1em] shrink-0", className)} {...props} />;
}
