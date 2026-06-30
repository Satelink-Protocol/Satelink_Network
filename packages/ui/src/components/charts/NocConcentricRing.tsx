"use client";
import * as React from "react";
import { cn } from "../../lib/utils";

export interface NocConcentricRingProps {
  progressValue: number; // 0 to 100
  title: string;
}

export function NocConcentricRing({ progressValue, title }: NocConcentricRingProps) {
  // SVG coordinates
  const cx = 50;
  const cy = 50;
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = circumference - (progressValue / 100) * circumference;

  return (
    <div className="flex flex-col border border-border bg-card rounded-md h-full">
      <div className="px-3 py-2 border-b border-border bg-muted/30">
        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-center p-4 relative">
        <svg viewBox="0 0 100 100" className="w-full h-full max-h-[150px]">
          {/* Inner decorative rings — CSS vars adapt to .satelink-os scope */}
          <circle
            cx={cx} cy={cy} r={r - 15}
            fill="none"
            stroke="hsl(var(--secondary))"
            strokeWidth="2"
            strokeDasharray="2 4"
          />
          <circle
            cx={cx} cy={cy} r={r - 8}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="1"
          />

          {/* Background track */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="hsl(var(--background))"
            strokeWidth="8"
          />

          {/* Progress bar */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 50 50)"
            className="transition-all duration-1000 ease-out"
          />

          {/* Center text */}
          <text
            x={cx}
            y={cy + 4}
            textAnchor="middle"
            fill="hsl(var(--foreground))"
            className="font-mono text-xl font-bold"
          >
            {Math.round(progressValue)}%
          </text>
        </svg>

        {/* Legend */}
        <div className="absolute right-4 bottom-4 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-primary rounded-sm" />
            <span className="text-[9px] text-muted-foreground uppercase font-mono">Status</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-border rounded-sm" />
            <span className="text-[9px] text-muted-foreground uppercase font-mono">Sub-agent</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-secondary rounded-sm" />
            <span className="text-[9px] text-muted-foreground uppercase font-mono">Epochal</span>
          </div>
        </div>
      </div>
    </div>
  );
}
