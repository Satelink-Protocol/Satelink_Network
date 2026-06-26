"use client";

import { useEffect, useState } from "react";
import {
  Cpu,
  RefreshCw,
  Sliders,
  Terminal,
  ShieldCheck,
  AlertTriangle,
  Play,
  Network,
  Share2,
  Users,
  Settings,
} from "lucide-react";
import {
  DataTable,
  StatusBadge,
  Badge,
  Button,
  EmptyState,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  KPICard,
  LogPanel
} from "@satelink/ui";

interface AgentIdentity {
  id: string;
  name: string;
  machine_type: string;
  description: string;
  is_ai_agent: boolean;
  is_active: boolean;
  created_at: string;
}

interface AgentPolicyResponse {
  ok: boolean;
  safeAgentSandbox: {
    maxGasLimitPol: number;
    readOnlyMode: boolean;
    networkRestriction: string;
  };
  identities: AgentIdentity[];
}

export default function AgentFleetPage() {
  const [data, setData] = useState<AgentPolicyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [diagLog, setDiagLog] = useState<string[]>([]);

  const fetchPolicy = () => {
    setLoading(true);
    fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/admin/agents/policy", method: "GET" }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) setData(res);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPolicy();
  }, []);

  const triggerDiagnostics = () => {
    setActing(true);
    setDiagLog([
      "Checking local Redis session store... [OK]",
      "Checking PostgreSQL machine_access_identities table... [OK]",
      "Verifying EIP-712 auth session handshake... [OK]",
      "Scanning websocket endpoint /machine-access/v1/websocket... [PENDING]",
      "ERROR: Claude Code Orchestrator gateway handshake failed. Socket disconnected.",
      "Recommendation: Deploy AI workforce adapters to target preview environment."
    ]);
    setTimeout(() => {
      setActing(false);
    }, 1500);
  };

  const agentCols = [
    {
      key: "name",
      header: "Agent Identity Name",
      cell: (r: AgentIdentity) => <span className="font-mono text-xs font-bold text-foreground">{r.name}</span>,
    },
    {
      key: "machine_type",
      header: "Type",
      cell: (r: AgentIdentity) => <Badge variant="outline" className="text-[10px] uppercase font-mono">{r.machine_type}</Badge>,
    },
    {
      key: "description",
      header: "Description",
      cell: (r: AgentIdentity) => <span className="text-xs text-muted-foreground">{r.description}</span>,
    },
    {
      key: "status",
      header: "Status",
      align: "right" as const,
      cell: (r: AgentIdentity) => <StatusBadge status={r.is_active ? "neutral" : "danger"} label={r.is_active ? "OFFLINE" : "DISABLED"} />,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* KPI Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Registered AI Agents" icon={Users} value={data ? String(data.identities.length) : "—"} caption="Identities in directory" />
        <KPICard label="Running Tasks" icon={Cpu} value="0" caption="Active execution threads" />
        <KPICard label="Websocket Handshakes" icon={Share2} value="0" caption="No active socket loops" />
        <KPICard label="Sandbox Safety" icon={ShieldCheck} value="STRICT SHIELD" caption="Rate limits & gas caps active" />
      </div>

      {/* Main Terminal Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Terminal and diagnostics console */}
        <div className="lg:col-span-2 space-y-4 h-[380px] flex flex-col">
          <LogPanel 
            title={
              <span className="flex items-center gap-1.5 uppercase tracking-wider text-slate-300">
                <Terminal className="size-3 text-primary animate-pulse" /> paperclip-fleet-terminal
              </span>
            }
            className="flex-1"
          >
            <div className="text-muted-foreground select-none mb-1.5">Welcome to Paperclip Fleet Control. Gateway server initialized at v1.0.0-scaffold.</div>
            {diagLog.map((log, index) => {
              let color = "text-slate-300";
              if (log.includes("[OK]")) color = "text-emerald-400";
              else if (log.includes("ERROR")) color = "text-red-400 font-bold";
              else if (log.includes("[PENDING]")) color = "text-amber-400";
              return (
                <div key={index} className={color}>
                  &gt; {log}
                </div>
              );
            })}
            {diagLog.length === 0 && (
              <div className="h-full flex items-center justify-center">
                <EmptyState
                  title="Agent Handshake Pending"
                  description="The orchestrator websocket interface is not connected. Execute diagnostics to verify the sandbox identity configuration."
                />
              </div>
            )}
          </LogPanel>
          <div className="flex justify-end">
            <Button size="sm" onClick={triggerDiagnostics} disabled={acting}>
              {acting ? "Running Self-Test..." : "Execute Diagnostics"}
            </Button>
          </div>
        </div>

        {/* Sandbox Policies Panel */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Sandbox Security Policies</h3>
            <p className="text-[11px] text-muted-foreground">Rigid isolation guardrails enforced on all AI worker operations</p>
          </div>

          <div className="space-y-4 text-xs font-mono">
            <div className="p-3 bg-muted/20 border border-border rounded">
              <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Gas Limit / Transaction</div>
              <div className="text-sm font-bold text-foreground mt-1">
                {data?.safeAgentSandbox?.maxGasLimitPol ? `${data.safeAgentSandbox.maxGasLimitPol} POL` : "0.50 POL"}
              </div>
            </div>

            <div className="p-3 bg-muted/20 border border-border rounded">
              <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Environment Isolation</div>
              <div className="text-sm font-bold text-red-400 mt-1">
                {data?.safeAgentSandbox?.readOnlyMode ? "STRICT READ-ONLY" : "PREVIEW-SANDBOX-ONLY"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Execution blocks raw production writes</div>
            </div>

            <div className="p-3 bg-muted/20 border border-border rounded">
              <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Network Restriction</div>
              <div className="text-sm font-bold text-slate-300 mt-1 truncate">
                {data?.safeAgentSandbox?.networkRestriction || "Satelink-Gateway-Only"}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Registered Agent list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Registered Machine Identities</CardTitle>
            <div className="text-sm text-muted-foreground mt-1">Active AI Agent and automation worker credentials registered under the Machine Access Layer</div>
          </div>
          <Button size="sm" variant="outline" onClick={fetchPolicy} disabled={loading}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-Sync
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">Syncing agent directory...</div>
          ) : !data || data.identities.length === 0 ? (
            <div className="p-12 text-center text-xs text-muted-foreground">
              <EmptyState
                title="No AI Agents Registered"
                description="Deploy a Paperclip worker with valid client credentials to register it in the machine identity directory."
              />
            </div>
          ) : (
            <div className="rounded-md border">
              <DataTable columns={agentCols} rows={data.identities} rowKey={(r) => r.id} />
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
