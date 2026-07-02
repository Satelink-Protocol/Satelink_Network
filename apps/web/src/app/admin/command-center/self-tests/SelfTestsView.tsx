"use client";

// Self-Tests — REAL subsystem health, no hardcoded pass/fail.
// Every row derives its verdict from a live backend signal:
//   Redis    → GET /admin/observability/metrics .redis_status  (real redis.ping())
//   Database → GET /admin/observability/metrics .db_status      (real SELECT 1)
//   Signer   → GET /admin/treasury/status .signer_balance_pol   (real RPC read; null is
//              surfaced as a FAILED check, not hidden — see INC/known-issue note)
//   Polygon  → GET /rpc/health (public)                         (real eth_blockNumber sync)
// A check with no live signal renders EmptyState "Check not yet wired".

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Terminal } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  KPICard,
  StatusPill,
  EmptyState,
  type SystemState,
} from "@satelink/ui";
import { ShieldCheck, Database, KeyRound, Network } from "lucide-react";

const RPC_URL = "https://rpc.satelink.network";

async function adminFetch(path: string) {
  const res = await fetch("/api/admin-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, method: "GET" }),
  });
  return res.json();
}

interface Check {
  id: string;
  subsystem: string;
  name: string;
  icon: typeof Database;
  /** null = no live signal yet (renders as "not wired"). */
  state: SystemState | null;
  verdict: string;
  detail: string;
}

const PENDING: Check[] = [
  { id: "redis", subsystem: "Cache", name: "Redis connection & ping", icon: ShieldCheck, state: null, verdict: "—", detail: "Awaiting /observability/metrics" },
  { id: "db", subsystem: "Database", name: "PostgreSQL SELECT 1", icon: Database, state: null, verdict: "—", detail: "Awaiting /observability/metrics" },
  { id: "signer", subsystem: "Settlement", name: "EVM signer balance read", icon: KeyRound, state: null, verdict: "—", detail: "Awaiting /treasury/status" },
  { id: "rpc", subsystem: "RPC", name: "Polygon eth_blockNumber sync", icon: Network, state: null, verdict: "—", detail: "Awaiting /rpc/health" },
];

export default function SelfTestsView() {
  const [checks, setChecks] = useState<Check[]>(PENDING);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<string>("");

  const run = useCallback(async () => {
    setRunning(true);
    const next = PENDING.map((c) => ({ ...c }));
    const set = (id: string, patch: Partial<Check>) => {
      const i = next.findIndex((c) => c.id === id);
      if (i >= 0) next[i] = { ...next[i], ...patch };
    };

    // Redis + Database — both from observability/metrics
    try {
      const m = await adminFetch("/observability/metrics");
      if (m?.ok && m.data) {
        const rs = m.data.redis_status;
        set("redis", rs === "ok"
          ? { state: "healthy", verdict: "PASS", detail: "redis.ping() → PONG" }
          : rs === "not_configured"
            ? { state: "unknown", verdict: "N/A", detail: "Redis not configured on this instance" }
            : { state: "critical", verdict: "FAIL", detail: `redis.ping() failed (status=${rs ?? "unknown"})` });
        const ds = m.data.db_status;
        set("db", ds === "ok"
          ? { state: "healthy", verdict: "PASS", detail: "SELECT 1 executed successfully" }
          : { state: "critical", verdict: "FAIL", detail: `SELECT 1 failed (status=${ds ?? "unknown"})` });
      } else {
        const detail = m?.error ? `metrics error: ${m.error}` : "metrics endpoint unreachable";
        set("redis", { state: "unknown", verdict: "ERR", detail });
        set("db", { state: "unknown", verdict: "ERR", detail });
      }
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : "request failed";
      set("redis", { state: "unknown", verdict: "ERR", detail });
      set("db", { state: "unknown", verdict: "ERR", detail });
    }

    // Signer balance — surface the real null/error state instead of hiding it
    try {
      const t = await adminFetch("/treasury/status");
      if (t?.ok && t.data) {
        const bal = t.data.signer_balance_pol;
        if (bal === null || bal === undefined) {
          set("signer", { state: "critical", verdict: "FAIL", detail: "signer_balance_pol is null — RPC read failed or signer unfunded (not hidden)" });
        } else if (Number(bal) <= 0) {
          set("signer", { state: "degraded", verdict: "WARN", detail: `signer at ${Number(bal)} POL — unfunded` });
        } else {
          set("signer", { state: "healthy", verdict: "PASS", detail: `balance ${Number(bal)} POL` });
        }
      } else {
        set("signer", { state: "unknown", verdict: "ERR", detail: t?.error ? `treasury error: ${t.error}` : "treasury endpoint unreachable" });
      }
    } catch (e: unknown) {
      set("signer", { state: "unknown", verdict: "ERR", detail: e instanceof Error ? e.message : "request failed" });
    }

    // Polygon RPC — public health endpoint (real eth_blockNumber checks)
    try {
      const r = await fetch(`${RPC_URL}/rpc/health`, { cache: "no-store" });
      const h = await r.json().catch(() => null);
      const providers = Array.isArray(h?.providers) ? h.providers : [];
      const poly = providers.filter((p: { chain?: string }) => p.chain === "polygon");
      const healthy = poly.filter((p: { status?: string }) => p.status === "healthy").length;
      if (poly.length > 0) {
        set("rpc", healthy > 0
          ? { state: healthy === poly.length ? "healthy" : "degraded", verdict: healthy === poly.length ? "PASS" : "WARN", detail: `${healthy}/${poly.length} Polygon providers healthy (eth_blockNumber)` }
          : { state: "critical", verdict: "FAIL", detail: "0 Polygon providers responding to eth_blockNumber" });
      } else {
        set("rpc", { state: "unknown", verdict: "ERR", detail: "no Polygon providers reported by /rpc/health" });
      }
    } catch (e: unknown) {
      set("rpc", { state: "unknown", verdict: "ERR", detail: e instanceof Error ? e.message : "rpc/health unreachable" });
    }

    setChecks(next);
    setRanAt(new Date().toLocaleTimeString());
    setRunning(false);
  }, []);

  useEffect(() => { run(); }, [run]);

  const scored = checks.filter((c) => c.state !== null);
  const passed = scored.filter((c) => c.verdict === "PASS").length;
  const failed = scored.filter((c) => c.verdict === "FAIL").length;
  const warned = scored.filter((c) => c.verdict === "WARN" || c.verdict === "ERR" || c.verdict === "N/A").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard label="Checks Passing" icon={ShieldCheck} value={scored.length ? `${passed}/${scored.length}` : "—"} caption={ranAt ? `Last run ${ranAt}` : "Running…"} />
        <KPICard label="Failing" icon={KeyRound} value={String(failed)} caption={failed > 0 ? "Action required" : "None"} />
        <KPICard label="Warnings / Unknown" icon={Network} value={String(warned)} caption="Degraded or unavailable" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Terminal className="size-4" /> Subsystem Self-Tests</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Live pass/fail from real backend health signals — no simulated results.</p>
          </div>
          <Button size="sm" onClick={run} disabled={running} className="flex items-center gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} /> {running ? "Running…" : "Re-run"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {checks.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Icon className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{c.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.subsystem}</span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate">{c.detail}</p>
                    </div>
                  </div>
                  {c.state === null ? (
                    <span className="text-xs text-muted-foreground">Check not yet wired</span>
                  ) : (
                    <StatusPill status={c.verdict} state={c.state} label={c.verdict} />
                  )}
                </div>
              );
            })}
          </div>
          {scored.length === 0 && !running ? (
            <div className="pt-4">
              <EmptyState title="No live signals yet" description="Health endpoints are unreachable from this session (admin token or backend not available)." />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
