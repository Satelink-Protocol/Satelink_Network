export const NAV = [
  { id: "overview", icon: "◈", label: "Overview" },
  { id: "radar", icon: "◎", label: "Demand Radar" },
  { id: "treasury", icon: "◉", label: "Treasury" },
  { id: "revenue", icon: "⊕", label: "Revenue" },
  { id: "agents", icon: "◐", label: "Agents" },
  { id: "settings", icon: "⊙", label: "Settings" },
];

export const HEADERS = {
  overview: { icon: "◈", title: "Overview", subtitle: "Gateway status & Customer Zero countdown" },
  radar: { icon: "◎", title: "Demand Radar", subtitle: "Lead pipeline, conversion & outreach" },
  treasury: { icon: "◉", title: "Treasury", subtitle: "Settlement control & on-chain status" },
  revenue: { icon: "⊕", title: "Revenue", subtitle: "Credit balance, pipeline & projection" },
  agents: { icon: "◐", title: "Agents", subtitle: "Automation jobs & agent fleet" },
  settings: { icon: "⊙", title: "Settings", subtitle: "Configuration reference" },
};

export const PROJECTIONS = [
  { daily: "$0.50/day", who: "1 paying customer", monthly: "$15/month" },
  { daily: "$1.50/day", who: "3 paying customers", monthly: "$45/month" },
  { daily: "$5.00/day", who: "7 paying customers", monthly: "$150/month" }
];

export const PROJECTION_DATA = [
  { label: "1 customer", daily: 0.5, monthly: 15 },
  { label: "3 customers", daily: 1.5, monthly: 45 },
  { label: "7 customers", daily: 5.0, monthly: 150 }
];

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
