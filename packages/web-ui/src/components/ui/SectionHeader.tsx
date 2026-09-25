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
        <p className="mb-3 text-sm font-medium text-sl-text-muted">
          {eyebrow}
        </p>
      )}
      <Heading className="text-balance font-sl-display text-[2rem] font-normal leading-[1.1] tracking-[-0.015em] text-sl-text sm:text-[2.75rem]">
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
