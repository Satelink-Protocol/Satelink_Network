"use client";

import * as React from "react";
import { RefreshCw, ExternalLink, AreaChart } from "lucide-react";

import { cn } from "../lib/utils";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { EmptyState } from "./empty-state";

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

type PanelStatus = "loading" | "ready" | "unconfigured";

/**
 * Embeds a single Grafana panel/dashboard inside the Satelink OS shell via an
 * iframe pointed at the server-side BFF (never Grafana directly).
 *
 * The BFF answers with a JSON error (HTTP 503) when Grafana isn't configured,
 * and an iframe's `onLoad` fires for *any* status — so naively mounting the
 * iframe would paint raw JSON into the panel. To avoid that, we first probe the
 * BFF: only a real Grafana document (non-JSON, 2xx) gets an iframe; anything
 * else degrades to a clean "Monitoring Coming Soon" empty state.
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
  const [status, setStatus] = React.useState<PanelStatus>("loading");
  // Bumping the nonce re-probes and remounts the iframe on refresh.
  const [nonce, setNonce] = React.useState(0);
  const resolvedSrc = withTheme(src, theme);

  const reload = React.useCallback(() => {
    setStatus("loading");
    setNonce((n) => n + 1);
  }, []);

  // Probe the embed proxy before rendering an iframe. A configured Grafana
  // returns an HTML document; an unconfigured/unreachable backend returns a
  // JSON error — never let that JSON reach the iframe.
  React.useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    fetch(resolvedSrc, { headers: { Accept: "text/html" } })
      .then((res) => {
        if (cancelled) return;
        const contentType = res.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json");
        if (!res.ok || isJson) {
          setStatus("unconfigured");
        } else {
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("unconfigured");
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedSrc, nonce]);

  const configured = status === "ready";

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
              {allowOpen && configured ? (
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

          {status === "unconfigured" ? (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <EmptyState
                icon={AreaChart}
                title="Monitoring Coming Soon"
                description="Connect Grafana to see live charts. Native metrics are available above."
                className="w-full border-0"
              />
            </div>
          ) : status === "ready" ? (
            <iframe
              key={nonce}
              src={resolvedSrc}
              title={title ?? "Grafana panel"}
              className="size-full border-0"
              loading="lazy"
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
