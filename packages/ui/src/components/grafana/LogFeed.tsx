import * as React from "react";
import { Terminal } from "lucide-react";
import { cn } from "../../lib/utils";
import { Card } from "../ui/card";

export type LogLevel = "info" | "warn" | "error" | "debug" | "unknown";

export interface LogEntry {
  id: string | number;
  timestamp: string | number;
  level: LogLevel;
  process?: string;
  message: string;
}

export interface LogFeedProps {
  logs: LogEntry[];
  maxRows?: number;
  loading?: boolean;
  /** Error message — renders instead of rows. */
  error?: string | null;
  emptyMessage?: string;
  className?: string;
}

export function LogFeed({
  logs,
  maxRows = 50,
  loading = false,
  error,
  emptyMessage = "No logs yet",
  className,
}: LogFeedProps) {
  // Use a map to track expanded rows individually
  const [expandedRows, setExpandedRows] = React.useState<Record<string, boolean>>({});

  const toggleRow = (id: string | number) => {
    setExpandedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const levelStyles = {
    info: {
      border: "border-blue-500",
      badge: "bg-blue-500/20 text-blue-400",
      label: "INFO",
    },
    warn: {
      border: "border-amber-500",
      badge: "bg-amber-500/20 text-amber-400",
      label: "WARN",
    },
    error: {
      border: "border-red-500",
      badge: "bg-red-500/20 text-red-400",
      label: "ERRO",
    },
    debug: {
      border: "border-gray-500",
      badge: "bg-gray-500/20 text-gray-400",
      label: "DBUG",
    },
    unknown: {
      border: "border-border",
      badge: "bg-muted text-muted-foreground",
      label: "UNKN",
    },
  };

  const displayLogs = logs.slice(0, maxRows);

  const formatTimestamp = (ts: string | number) => {
    const d = new Date(ts);
    return d.toISOString().replace("T", " ").substring(0, 23); // YYYY-MM-DD HH:mm:ss.SSS
  };

  return (
    <Card
      className={cn(
        "flex flex-col bg-[hsl(var(--card))] border border-border overflow-hidden",
        className
      )}
    >
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
        <Terminal className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Live Logs {displayLogs.length > 0 && `(${displayLogs.length})`}
        </span>
        {loading && (
          <div className="ml-auto flex items-center gap-2 text-xs text-primary">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            STREAMING
          </div>
        )}
      </div>

      <div className="max-h-[400px] overflow-y-auto scrollbar-thin flex-1 p-0 m-0 bg-background/50">
        {error && !loading ? (
          <div role="alert" className="flex items-center justify-center h-32 text-sm text-destructive font-mono">
            {error}
          </div>
        ) : logs.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground font-mono">
            {emptyMessage}
          </div>
        ) : (
          <div className="flex flex-col">
            {displayLogs.map((log, index) => {
              const isExpanded = !!expandedRows[log.id];
              const styles = levelStyles[log.level] || levelStyles.unknown;
              const isEven = index % 2 === 0;

              return (
                <div
                  key={log.id}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleRow(log.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleRow(log.id);
                    }
                  }}
                  className={cn(
                    "flex items-start gap-2 py-1.5 px-3 font-mono text-[11px] cursor-pointer transition-colors border-l-2",
                    isEven ? "bg-transparent" : "bg-muted/20",
                    "hover:bg-muted/40",
                    styles.border
                  )}
                >
                  <div className="text-muted-foreground whitespace-nowrap min-w-[140px] tabular-nums mt-0.5">
                    {formatTimestamp(log.timestamp)}
                  </div>
                  
                  <div
                    className={cn(
                      "px-1 rounded-sm text-[9px] font-bold tracking-wider mt-0.5 shrink-0",
                      styles.badge
                    )}
                  >
                    {styles.label}
                  </div>
                  
                  {log.process && (
                    <div className="text-primary/70 font-semibold whitespace-nowrap mt-0.5 shrink-0">
                      [{log.process}]
                    </div>
                  )}
                  
                  <div
                    className={cn(
                      "text-foreground break-words flex-1 leading-relaxed",
                      !isExpanded && "truncate"
                    )}
                  >
                    {log.message}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
