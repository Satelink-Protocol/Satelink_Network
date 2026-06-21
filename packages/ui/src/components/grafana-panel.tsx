"use client";

import * as React from "react";
import { RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";

import { cn } from "../lib/utils";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export interface GrafanaPanelProps {
  /** Embed URL — typically a BFF path like `/api/grafana/d-solo/<uid>?panelId=1`. */
  src: string;
  /** Panel title shown in the card header. */
  title?: string;
  description?: string;
  /** iframe height in px (the panel is always full-width / responsive). */
  height?: number;
  /** Append `&theme=dark|light`. Defaults to "dark" (Satelink OS is dark). */
  theme?: "dark" | "light";
  /** Show a manual refresh control (re-mounts the iframe). Default true. */
  refresh?: boolean;
  /** Open-in-Grafana link target (the same src, new tab). Default true. */
  allowOpen?: boolean;
  className?: string;
}

function withTheme(src: string, theme: "dark" | "light"): string {
  if (/[?&]theme=/.test(src)) return src;
  return src + (src.includes("?") ? "&" : "?") + "theme=" + theme;
}

/**
 * Embeds a single Grafana panel/dashboard inside the Satelink OS shell via an
 * iframe pointed at the server-side BFF (never Grafana directly). Owns its own
 * loading and error states so a missing/unconfigured monitoring backend
 * degrades to an honest message instead of a blank frame.
 */
export function GrafanaPanel({
  src,
  title,
  description,
  height = 240,
  theme = "dark",
  refresh = true,
  allowOpen = true,
  className,
}: GrafanaPanelProps) {
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading"
  );
  // Bumping the key forces the iframe to remount on refresh.
  const [nonce, setNonce] = React.useState(0);
  const resolvedSrc = withTheme(src, theme);

  const reload = React.useCallback(() => {
    setStatus("loading");
    setNonce((n) => n + 1);
  }, []);

  return (
    <Card data-slot="grafana-panel" className={cn("overflow-hidden", className)}>
      {(title || refresh || allowOpen) && (
        <CardHeader>
          {title ? <CardTitle>{title}</CardTitle> : <span />}
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
          <CardAction>
            <div className="flex items-center gap-1">
              {refresh ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={reload}
                  aria-label="Refresh panel"
                  title="Refresh"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              ) : null}
              {allowOpen ? (
                <Button
                  size="icon"
                  variant="ghost"
                  asChild
                  aria-label="Open in Grafana"
                  title="Open in Grafana"
                >
                  <a href={resolvedSrc} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              ) : null}
            </div>
          </CardAction>
        </CardHeader>
      )}
      <CardContent className="px-0">
        <div className="relative w-full" style={{ height }}>
          {status === "loading" ? (
            <Skeleton className="absolute inset-0 size-full rounded-none" />
          ) : null}

          {status === "error" ? (
            <div
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
            >
              <div className="flex size-9 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="size-4" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Panel unavailable
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                The monitoring backend isn&apos;t reachable. Confirm Grafana is
                deployed and the embed proxy is configured.
              </p>
              {refresh ? (
                <Button size="sm" variant="outline" onClick={reload} className="mt-1">
                  Retry
                </Button>
              ) : null}
            </div>
          ) : (
            <iframe
              key={nonce}
              src={resolvedSrc}
              title={title ?? "Grafana panel"}
              className={cn(
                "size-full border-0 transition-opacity",
                status === "ready" ? "opacity-100" : "opacity-0"
              )}
              loading="lazy"
              onLoad={() => setStatus("ready")}
              onError={() => setStatus("error")}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
