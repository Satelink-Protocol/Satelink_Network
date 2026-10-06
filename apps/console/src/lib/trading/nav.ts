// Stage 25 — agent-first information architecture (behind CONSOLE_AGENT_IA).
// The live RPC / x402 / keys / requests / usage pages are KEPT under "Developer & payments"
// (founder decision 2026-10-06, Option 1). No DePIN or marketplace entry exists here.
// Nothing is deleted: with the flag off the console shows today's navigation.
export type AgentNavItem = { href: string; label: string; key: string; icon: string; group: string; adminOnly?: boolean };

export const AGENT_NAV_GROUPS = ["", "Trading", "Developer & payments", "Account", "Admin"] as const;

export const AGENT_NAV: readonly AgentNavItem[] = Object.freeze([
  { href: "/trading", label: "Home", key: "h", icon: "home", group: "" },
  { href: "/trading/agent", label: "Agent", key: "a", icon: "bot", group: "" },
  { href: "/trading-intelligence", label: "Markets", key: "m", icon: "line-chart", group: "Trading" },
  { href: "/trading/strategies", label: "Strategies", key: "g", icon: "workflow", group: "Trading" },
  { href: "/trading/risk", label: "Risk", key: "r", icon: "shield", group: "Trading" },
  { href: "/trading/brokers", label: "Brokers", key: "b", icon: "landmark", group: "Trading" },
  { href: "/trading/positions", label: "Positions", key: "p", icon: "briefcase", group: "Trading" },
  { href: "/trading/orders", label: "Orders", key: "o", icon: "list-ordered", group: "Trading" },
  { href: "/trading/executions", label: "Executions", key: "e", icon: "check-check", group: "Trading" },
  { href: "/trading/pnl", label: "P&L", key: "l", icon: "bar-chart", group: "Trading" },
  { href: "/trading/activity", label: "Activity", key: "v", icon: "activity", group: "Trading" },
  { href: "/keys", label: "API keys", key: "k", icon: "key", group: "Developer & payments" },
  { href: "/requests", label: "Requests", key: "q", icon: "activity", group: "Developer & payments" },
  { href: "/usage", label: "Usage", key: "u", icon: "bar-chart", group: "Developer & payments" },
  { href: "/rpc", label: "RPC", key: "c", icon: "server", group: "Developer & payments" },
  { href: "/x402", label: "x402", key: "x", icon: "zap", group: "Developer & payments" },
  { href: "/billing", label: "Billing", key: "i", icon: "credit-card", group: "Account" },
  { href: "/security", label: "Security", key: "s", icon: "lock", group: "Account" },
  { href: "/settings", label: "Settings", key: "t", icon: "settings", group: "Account" },
  { href: "/trading/revenue", label: "Revenue", key: "n", icon: "landmark", group: "Admin", adminOnly: true },
].map((i) => Object.freeze(i)));

/** The 14 customer-facing IA areas from the brief (Revenue is admin-only). */
export const IA_AREAS = ["Home", "Agent", "Markets", "Strategies", "Risk", "Brokers", "Positions", "Orders", "Executions", "P&L", "Activity", "Billing", "Security", "Settings"] as const;

export function agentNav({ revenueAdmin }: { revenueAdmin: boolean }): AgentNavItem[] {
  return AGENT_NAV.filter((i) => !i.adminOnly || revenueAdmin);
}

export const AGENT_TABS = Object.freeze([
  { href: "/trading", label: "Home", icon: "home" },
  { href: "/trading/agent", label: "Agent", icon: "bot" },
  { href: "/trading/orders", label: "Orders", icon: "list-ordered" },
  { href: "/trading/risk", label: "Risk", icon: "shield" },
]);
