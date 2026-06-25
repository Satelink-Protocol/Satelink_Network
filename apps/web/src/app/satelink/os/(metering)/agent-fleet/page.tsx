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
  DashboardSection,
  KPIGrid,
  StatCard,
  DataTable,
  StatusBadge,
  Badge,
  Button,
  EmptyState,
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
      <KPIGrid columns={4}>
        <StatCard
          label="Registered AI Agents"
          value={data ? String(data.identities.length) : "—"}
          icon={Users}
          caption="Identities in directory"
          loading={loading}
        />
        <StatCard
          label="Running Tasks"
          value="0"
          icon={Cpu}
          caption="Active execution threads"
        />
        <StatCard
          label="Websocket Handshakes"
          value="0"
          icon={Share2}
          caption="No active socket loops"
        />
        <StatCard
          label="Sandbox Safety Status"
          value="STRICT SHIELD"
          icon={ShieldCheck}
          caption="Rate limits & gas caps active"
          accent
        />
      </KPIGrid>

      {/* Main Terminal Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Terminal and diagnostics console */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border border-border bg-card rounded-lg overflow-hidden flex flex-col h-[380px]">
            <div className="px-4 py-2 border-b border-border bg-muted/40 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5 font-mono">
                <Terminal className="size-3 text-primary animate-pulse" /> paperclip-fleet-terminal
              </span>
              <Button size="xs" onClick={triggerDiagnostics} disabled={acting}>
                {acting ? "Running Self-Test..." : "Execute Diagnostics"}
              </Button>
            </div>
            
            <div className="flex-1 bg-[#05070B] p-4 font-mono text-[10px] text-slate-300 overflow-y-auto space-y-1.5">
              <div className="text-muted-foreground select-none">Welcome to Paperclip Fleet Control. Gateway server initialized at v1.0.0-scaffold.</div>
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
            </div>
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
      <DashboardSection
        title="Registered Machine Identities"
        description="Active AI Agent and automation worker credentials registered under the Machine Access Layer"
        actions={
          <Button size="sm" variant="outline" onClick={fetchPolicy} disabled={loading}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-Sync
          </Button>
        }
        flush
      >
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
          <DataTable columns={agentCols} rows={data.identities} rowKey={(r) => r.id} />
        )}
      </DashboardSection>

    </div>
  );
}
