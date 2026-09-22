"use client";
// LiveNetworkStrip — real network signals from the public /health endpoint
// (the same probe /status uses). Never fabricates: on a failed/slow fetch the
// tiles show StatTile's "Live data unavailable — view status" state, never a
// placeholder number. calls-today / p50 are intentionally omitted — there is
// no public endpoint for them (see docs/web/DECISIONS.md); full metrics live
// on the status page.
import * as React from "react";
import { StatTile } from "@/components/ui/StatTile";

const HEALTH_URL = "https://rpc.satelink.network/health";

type Health = { ok?: boolean; server?: string; db?: string; uptime?: number };

function formatUptime(sec?: number): string | null {
  if (!sec || !Number.isFinite(sec)) return null;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function LiveNetworkStrip() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [state, setState] = React.useState<"loading" | "ok" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(HEALTH_URL, {
          cache: "no-store",
          mode: "cors",
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Health;
        if (!cancelled) {
          setHealth(data);
          setState("ok");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }
    check();
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const loading = state === "loading";
  const error = state === "error";
  const gatewayOk = health?.server === "ok";
  const dbOk = health?.db === "ok";

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatTile
        label="Gateway"
        value={error ? undefined : gatewayOk ? "Operational" : "Degraded"}
        loading={loading}
        error={error}
      />
      <StatTile
        label="Database"
        value={error ? undefined : dbOk ? "Operational" : "Degraded"}
        loading={loading}
        error={error}
      />
      <StatTile
        label="Uptime"
        value={error ? undefined : formatUptime(health?.uptime)}
        loading={loading}
        error={error}
      />
    </div>
  );
}
