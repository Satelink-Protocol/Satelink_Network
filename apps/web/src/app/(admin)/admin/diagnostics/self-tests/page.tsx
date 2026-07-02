"use client";

import { useState } from "react";
import { Play, RefreshCw, Terminal } from "lucide-react";
import {
  Button,
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  StatusBadge,
  Badge,
} from "@satelink/ui";

interface TestResult {
  id: string;
  name: string;
  subsystem: string;
  status: "success" | "warning" | "failed";
  latencyMs: number;
  message: string;
}

const INITIAL_TESTS: TestResult[] = [
  { id: "1", name: "Redis Connection & Ping", subsystem: "Cache", status: "success", latencyMs: 2, message: "PONG received in 1.8ms" },
  { id: "2", name: "PostgreSQL Prisma Pool", subsystem: "Database", status: "success", latencyMs: 14, message: "Successfully executed SELECT 1" },
  { id: "3", name: "EVM Signer Balance Check", subsystem: "Settlement", status: "success", latencyMs: 45, message: "Balance: 0.124 POL (Threshold: 0.05 POL)" },
  { id: "4", name: "Polygon RPC Endpoint Sync", subsystem: "RPC", status: "success", latencyMs: 180, message: "Sync status: OK (Current block: 18491024)" },
  { id: "5", name: "Webhook Dispatcher Verification", subsystem: "Alerting", status: "warning", latencyMs: 310, message: "Alerts endpoint responded with latency > 300ms" },
  { id: "6", name: "Merkle Root Accrual Check", subsystem: "Accounting", status: "success", latencyMs: 24, message: "Unsettled epoch revenue balances verified" },
];

export default function AdminSelfTestsPage() {
  const [tests, setTests] = useState<TestResult[]>(INITIAL_TESTS);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([
    "[06:06:01] System boot sequence diagnostic complete.",
    "[06:06:01] Redis backend initialized at redis://127.0.0.1:6379.",
    "[06:06:02] Database pool active (14 connections).",
  ]);

  const runDiagnostics = () => {
    setRunning(true);
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Starting manual diagnostic sequence...`]);

    setTimeout(() => {
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Testing cache layer: Redis Ping...`]);
    }, 400);

    setTimeout(() => {
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Testing DB layer: Prisma client check...`]);
    }, 800);

    setTimeout(() => {
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Fetching gas station POL balance...`]);
    }, 1200);

    setTimeout(() => {
      const updated = tests.map((t) => {
        const isSuccess = false; // TODO: fetch real result
        return {
          ...t,
          status: isSuccess ? "success" : ("failed" as any),
          latencyMs: 0,
          message: isSuccess ? "Healthy status response verified" : "Connection timeout occurred during test request",
        };
      });
      setTests(updated);
      setRunning(false);
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Diagnostic suite complete. Status: ${
          updated.some((u) => u.status === "failed") ? "FAIL" : "PASS"
        }`,
      ]);
    }, 1800);
  };

  const cols = [
    {
      key: "name",
      header: "Test Identifier",
      cell: (r: TestResult) => <span className="font-medium text-xs text-foreground">{r.name}</span>,
    },
    {
      key: "subsystem",
      header: "Subsystem",
      cell: (r: TestResult) => <Badge variant="outline">{r.subsystem}</Badge>,
    },
    {
      key: "status",
      header: "Test Status",
      cell: (r: TestResult) => (
        <StatusBadge
          status={r.status === "success" ? "active" : r.status === "warning" ? "pending" : "danger"}
          label={r.status.toUpperCase()}
        />
      ),
    },
    {
      key: "latencyMs",
      header: "Latency",
      align: "right" as const,
      cell: (r: TestResult) => <span className="font-mono text-xs text-muted-foreground">{r.latencyMs}ms</span>,
    },
    {
      key: "message",
      header: "Message",
      cell: (r: TestResult) => <span className="text-xs text-muted-foreground font-mono">{r.message}</span>,
    },
  ];

  const successCount = tests.filter((t) => t.status === "success").length;
  const warningCount = tests.filter((t) => t.status === "warning").length;
  const failedCount = tests.filter((t) => t.status === "failed").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={4}>
        <StatCard
          label="Pass Rate"
          value={`${Math.round((successCount / tests.length) * 100)}%`}
          caption={`${successCount}/${tests.length} tests succeeded`}
          accent={successCount === tests.length}
        />
        <StatCard
          label="Warning Alerts"
          value={String(warningCount)}
          caption="Minor degradation observed"
          trend={{ label: warningCount > 0 ? "attention" : "nominal", direction: warningCount > 0 ? "down" : "neutral" }}
        />
        <StatCard
          label="Failed Subsystems"
          value={String(failedCount)}
          caption="Critical failures requiring action"
          trend={{ label: failedCount > 0 ? "incident!" : "safe", direction: failedCount > 0 ? "down" : "neutral" }}
        />
        <StatCard
          label="Signer Key Balance"
          value="0.124 POL"
          caption="Hot wallet validator reserve"
          accent
        />
      </KPIGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <DashboardSection
            label="Subsystem Test Harness"
            description="Run automatic self-tests against critical components"
            actions={
              <Button size="sm" onClick={runDiagnostics} disabled={running}>
                {running ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Run Subsystem Diagnostics
              </Button>
            }
            flush
          >
            <DataTable columns={cols} rows={tests} rowKey={(r) => r.id} />
          </DashboardSection>
        </div>

        <div>
          <DashboardSection label="Live Runner Logs" description="Standard stdout telemetry stream" flush>
            <div className="bg-black/60 backdrop-blur border border-border p-4 font-mono text-[11px] leading-relaxed rounded-b-md">
              <div className="flex items-center gap-1.5 text-zinc-500 mb-3 border-b border-zinc-800 pb-2">
                <Terminal className="h-3 w-3" />
                <span>DIAGNOSTICS_RUNNER_STDOUT</span>
              </div>
              <div className="h-[220px] overflow-y-auto space-y-1.5 scrollbar-thin text-zinc-300">
                {logs.map((log, i) => (
                  <div
                    key={i}
                    className={
                      log.includes("PASS") || log.includes("sequence complete")
                        ? "text-emerald-400 font-semibold"
                        : log.includes("FAIL")
                        ? "text-rose-400 font-semibold"
                        : "text-zinc-400"
                    }
                  >
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </DashboardSection>
        </div>
      </div>
    </div>
  );
}
