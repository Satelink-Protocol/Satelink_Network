import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export type AlertSeverity = "critical" | "high" | "warning" | "info" | "resolved";

export interface AlertItem {
  code: string;
  message: string;
  severity: AlertSeverity;
  /** Optional timestamp rendered in a mono gutter (timeline support). */
  ts?: string | number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface AlertBandProps {
  alerts: AlertItem[];
  collapsible?: boolean;
  className?: string;
}

export function AlertBand({
  alerts,
  collapsible = true,
  className,
}: AlertBandProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  if (!alerts || alerts.length === 0) return null;

  const severityStyles: Record<
    AlertSeverity,
    { wrapper: string; iconColor: string; icon: React.ElementType }
  > = {
    critical: {
      wrapper: "border-red-500/40 bg-red-500/10 text-red-300 border-l-red-500",
      iconColor: "text-red-400",
      icon: AlertTriangle,
    },
    high: {
      wrapper:
        "border-orange-500/40 bg-orange-500/10 text-orange-300 border-l-orange-500",
      iconColor: "text-orange-400",
      icon: AlertTriangle,
    },
    warning: {
      wrapper:
        "border-amber-500/40 bg-amber-500/10 text-amber-300 border-l-amber-500",
      iconColor: "text-amber-400",
      icon: AlertTriangle,
    },
    info: {
      wrapper: "border-blue-500/40 bg-blue-500/10 text-blue-300 border-l-blue-500",
      iconColor: "text-blue-400",
      icon: Info,
    },
    resolved: {
      wrapper:
        "border-[hsl(var(--state-healthy)/0.4)] bg-[hsl(var(--state-healthy)/0.1)] text-state-healthy border-l-[hsl(var(--state-healthy))]",
      iconColor: "text-state-healthy",
      icon: CheckCircle2,
    },
  };

  if (isCollapsed) {
    return (
      <div
        className={cn(
          "flex w-full items-center justify-between rounded border border-border bg-muted/30 px-4 py-2",
          className
        )}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
          <AlertTriangle className="h-4 w-4" />
          {alerts.length} active alert{alerts.length === 1 ? "" : "s"}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(false)}
          className="h-7 px-2 text-xs"
        >
          Expand <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1 w-full", className)}>
      {alerts.map((alert, idx) => {
        const style = severityStyles[alert.severity] || severityStyles.info;
        const Icon = style.icon;
        
        return (
          <div
            key={`${alert.code}-${idx}`}
            className={cn(
              "flex items-center justify-between gap-3 px-4 py-2.5 text-sm border border-l-4 rounded-sm transition-colors",
              style.wrapper
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Icon className={cn("h-4 w-4 shrink-0", style.iconColor)} />
              <div className="flex items-baseline gap-2 truncate">
                {alert.ts != null && (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums opacity-60">
                    {new Date(alert.ts).toISOString().replace("T", " ").substring(5, 19)}
                  </span>
                )}
                <span className="shrink-0 rounded bg-background/40 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider opacity-80 border border-background/20">
                  {alert.code}
                </span>
                <span className="truncate opacity-90">{alert.message}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {alert.action && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={alert.action.onClick}
                  className={cn(
                    "h-7 px-3 text-xs hover:bg-background/20",
                    style.iconColor
                  )}
                >
                  {alert.action.label}
                </Button>
              )}
              {collapsible && idx === 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsCollapsed(true)}
                  className="h-6 w-6 rounded-full hover:bg-background/20 opacity-70 hover:opacity-100"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
