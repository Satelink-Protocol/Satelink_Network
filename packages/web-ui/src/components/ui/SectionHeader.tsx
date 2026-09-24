// SectionHeader — eyebrow, title, lede. Centered by default; `align="left"`.
import * as React from "react";
import { cn } from "../../lib/utils";

export interface SectionHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: "center" | "left";
  as?: "h1" | "h2" | "h3";
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  lede,
  align = "center",
  as: Heading = "h2",
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left",
        className
      )}
    >
      {eyebrow && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">
          {eyebrow}
        </p>
      )}
      <Heading className="text-balance text-[1.75rem] font-bold tracking-[-0.02em] text-sl-text sm:text-[2.25rem]">
        {title}
      </Heading>
      {lede && (
        <p className="mt-4 text-pretty text-base leading-relaxed text-sl-text-muted sm:text-lg">
          {lede}
        </p>
      )}
    </div>
  );
}
