// Card — elevated surface container. Optional `interactive` adds hover lift.
import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  as?: React.ElementType;
}

export function Card({ className, interactive, as: Comp = "div", ...props }: CardProps) {
  return (
    <Comp
      className={cn(
        "rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6",
        interactive &&
          "transition-colors duration-[var(--sl-dur-2)] hover:border-sl-border-strong hover:bg-sl-surface-hover",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lg font-semibold tracking-tight text-sl-text", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1.5 text-sm leading-relaxed text-sl-text-muted", className)} {...props} />;
}
