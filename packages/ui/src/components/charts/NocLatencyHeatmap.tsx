"use client";
import * as React from "react";
import { cn } from "../../lib/utils";

export interface NocLatencyHeatmapProps {
  title: string;
}

export function NocLatencyHeatmap({ title }: NocLatencyHeatmapProps) {
  // Generate a realistic-looking 10x8 grid (80 cells)
  // Lower rows represent newer data or different servers
  const rows = 8;
  const cols = 10;
  
  // We'll deterministically generate colors based on index for a "live" feel
  // Colors: 
  // ~80% #00ADB5 (Neon Blue - Normal)
  // ~15% #5C8374 (Muted Green - Slight delay)
  // ~4% #F59E0B (Warning/Yellow - High delay)
  // ~1% #E11D48 (Red - Error)
  
  const getCellColor = (i: number) => {
    // A pseudo-random function based on index and current minute so it looks static but random
    const rand = Math.abs(Math.sin(i * 12.5 + 4) * 100); 
    if (rand > 96) return "bg-destructive";
    if (rand > 85) return "bg-warning";
    if (rand > 60) return "bg-[#5C8374]";
    return "bg-[#00ADB5]";
  };

  return (
    <div className="flex flex-col border border-border bg-card rounded-md h-full">
      <div className="px-3 py-2 border-b border-border bg-muted/30 flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
          {title}
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-sm bg-[#00ADB5]"/> <span className="text-[8px] text-muted-foreground">&lt;50ms</span></div>
          <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-sm bg-[#5C8374]"/> <span className="text-[8px] text-muted-foreground">100ms</span></div>
          <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-sm bg-warning"/> <span className="text-[8px] text-muted-foreground">High</span></div>
          <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-sm bg-destructive"/> <span className="text-[8px] text-muted-foreground">Fail</span></div>
        </div>
      </div>
      <div className="flex-1 p-3 flex flex-col justify-between">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex justify-between items-center w-full gap-1">
            <span className="text-[8px] font-mono text-muted-foreground w-4">S{r+1}</span>
            <div className="flex flex-1 justify-between gap-1">
              {Array.from({ length: cols }).map((_, c) => {
                const i = r * cols + c;
                return (
                  <div 
                    key={c}
                    className={cn(
                      "flex-1 aspect-square rounded-[1px] opacity-80 hover:opacity-100 cursor-crosshair transition-opacity",
                      getCellColor(i)
                    )}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
