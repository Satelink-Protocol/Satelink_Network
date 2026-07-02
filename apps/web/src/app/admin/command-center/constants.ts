import { LayoutDashboard, Radar, Building, DollarSign, Settings, Bot, Activity, CreditCard, ShieldAlert, AlertTriangle, Mail, Network, Server, Users } from "lucide-react";

export const NAV = [
  {
    label: "Command Center",
    items: [
      { id: "executive", icon: LayoutDashboard, label: "Executive" },
      { id: "radar", icon: Radar, label: "Demand Radar" },
      { id: "treasury", icon: Building, label: "Treasury" },
      { id: "revenue", icon: DollarSign, label: "Revenue Control" },
      { id: "network", icon: Activity, label: "Network Health" },
      { id: "providers", icon: Network, label: "Providers" },
      { id: "nodes", icon: Server, label: "Node Operations" },
      { id: "customers", icon: Users, label: "Customer Ops" },
      { id: "observability", icon: Activity, label: "Observability" },
      { id: "billing", icon: CreditCard, label: "Billing & Credits" },
      { id: "agents", icon: Bot, label: "Agents Fleet" },
      { id: "security", icon: ShieldAlert, label: "Security Ops" },
      { id: "outreach", icon: Mail, label: "Outreach" },
      { id: "incidents", icon: AlertTriangle, label: "Incidents & Audits" },
      { id: "settings", icon: Settings, label: "System Config" },
    ]
  }
];

export const HEADERS: Record<string, { title: string; subtitle: string; icon: any }> = {
  executive: { title: "Executive Overview", subtitle: "NOC executive dashboard & live risk analysis", icon: LayoutDashboard },
  radar: { title: "Demand Radar", subtitle: "IP analysis, conversion funnel & leads tracking", icon: Radar },
  treasury: { title: "Treasury Operations", subtitle: "On-chain settlements, wallet states & dry-run switches", icon: Building },
  revenue: { title: "Revenue Control", subtitle: "Lifetime income logs, billing rates & ledger events", icon: DollarSign },
  network: { title: "Network Status", subtitle: "API latency metrics, node list & availability tracking", icon: Activity },
  providers: { title: "Provider Operations", subtitle: "RPC provider routing, health, costs and fallback tracking", icon: Network },
  nodes: { title: "Node Operations", subtitle: "Registered node performance, reputation and economics", icon: Server },
  customers: { title: "Customer Operations", subtitle: "Customer accounts, credits, revenue and activity", icon: Users },
  observability: { title: "Observability Center", subtitle: "Infrastructure metrics, database, Redis, and API telemetry", icon: Activity },
  billing: { title: "Billing & Credits", subtitle: "Credit distribution, customer listings & token deposits", icon: CreditCard },
  agents: { title: "Automation & Agents", subtitle: "Satelink background tasks & Live SSE NOC feed", icon: Bot },
  security: { title: "Security Operations", subtitle: "L3 firewall blocks, threat detection & ASN blacklists", icon: ShieldAlert },
  outreach: { title: "Outreach", subtitle: "Send emails to infrastructure partners via Brevo", icon: Mail },
  incidents: { title: "Incidents & Audits", subtitle: "System outage timelines & administrative audit trails", icon: AlertTriangle },
  settings: { title: "System Config", subtitle: "Verified global constants & environment state variables", icon: Settings },
};

export const PROJECTIONS = [];
export const PROJECTION_DATA = [];

export const ARCH_TOPOLOGY = {
  width: 680, height: 220,
  nodes: [
    { id: "clients", label: "CLIENTS", x: 340, y: 20, kind: "source" },
    { id: "gate", label: "FREE-TIER GATE", x: 340, y: 64, kind: "edge" },
    { id: "gateway", label: "RPC GATEWAY", sub: "rpc.satelink.network", x: 340, y: 108, kind: "gateway" },
    { id: "u1", label: "UPSTREAM", x: 150, y: 162, kind: "edge" },
    { id: "u2", label: "UPSTREAM", x: 280, y: 162, kind: "edge" },
    { id: "u3", label: "UPSTREAM", x: 400, y: 162, kind: "edge" },
    { id: "u4", label: "UPSTREAM", x: 530, y: 162, kind: "edge" },
    { id: "settle", label: "BILLING · EPOCH", x: 340, y: 200, kind: "sink" }
  ],
  links: [
    { from: "clients", to: "gate", tone: "primary", dur: "1.4s" },
    { from: "gate", to: "gateway", tone: "info", dur: "1.5s" },
    { from: "gateway", to: "u1", tone: "info", dur: "1.9s" },
    { from: "gateway", to: "u2", tone: "info", dur: "1.7s" },
    { from: "gateway", to: "u3", tone: "info", dur: "1.8s" },
    { from: "gateway", to: "u4", tone: "info", dur: "2.1s" },
    { from: "u1", to: "settle", tone: "success", dur: "2.0s" },
    { from: "u4", to: "settle", tone: "success", dur: "2.0s" }
  ]
};

export const TEMPLATES = [
  { id: "erpc-provider", label: "erpc provider intro" },
  { id: "followup-72h", label: "72h follow-up" }
];

export const TRIGGERABLE_JOBS = ["ip-classifier", "customer-zero", "outreach"];
export const NEXT_STAGE: Record<string, string> = { identified: "contacted", contacted: "deposited", deposited: "paid" };
export const STAGE_BTN: Record<string, string> = { contacted: "Mark Contacted", deposited: "Mark Deposited", paid: "Mark Paid" };
export const stageTone = (s: string) => ({ identified: "info", contacted: "warn", deposited: "primary", paid: "success" }[s] || "muted") as any;

export const fmt = {
  num: (n: number | undefined) => n == null || Number.isNaN(Number(n)) ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n),
  bal: (n: number | string | undefined) => n == null ? "—" : Number(n).toFixed(4),
  addr: (a: string | undefined) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—",
  time: (t: string | undefined) => { if (!t) return "—"; const d = new Date(t); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString(); }
};
