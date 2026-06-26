import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export interface NocStatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  progress?: number; // 0 to 100 for the inline cyan bar
  className?: string;
  status?: "default" | "warning" | "critical";
}

export function NocStatCard({
  label,
  value,
  icon: Icon,
  progress,
  className,
  status = "default",
}: NocStatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between p-3 border border-border bg-card rounded-md relative overflow-hidden",
        className
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground truncate">
          {label}
        </span>
      </div>
      
      <div className="flex-1 flex items-end">
        <span className={cn(
          "font-mono text-2xl font-bold tracking-tight",
          status === "critical" ? "text-destructive" : 
          status === "warning" ? "text-warning" : "text-foreground"
        )}>
          {value}
        </span>
      </div>

      {progress !== undefined && (
        <div className="absolute bottom-0 left-0 w-full h-[3px] bg-muted">
          <div 
            className="h-full bg-primary transition-all duration-500 ease-out" 
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} 
          />
        </div>
      )}
    </div>
  );
}
