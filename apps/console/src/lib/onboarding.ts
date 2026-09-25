// Onboarding (CONSOLE_ONBOARDING_V1) — shared types and the words the flow
// shows. The API owns the state and validates every value (use cases, tasks,
// steps); the labels here are presentation only. Safe to import in the client.

export type OnboardingStep = "account" | "name" | "use" | "plan" | "review" | "payment" | "safety" | "done";

export type Onboarding = {
  step: OnboardingStep;
  legacy: boolean;
  displayName: string;
  email: string | null;
  useCase: string | null;
  firstTask: string | null;
  suggestedTasks: string[];
  recommendedPlan: string | null;
  planId: string | null;
  period: "month" | "year" | null;
  itemId: string | null;
  payment: "pending" | "confirmed" | "failed" | null;
  consents: Record<string, { granted: boolean; document: string | null; version: string | null; at: string }>;
  documents: Record<string, { version: string; url: string }>;
  spendCapDefaultUsd: number;
  completedAt: string | null;
};

export const USE_CASE_LABELS: Record<string, string> = {
  automated_trading: "Automated trading (bots and strategies)",
  ai_agent: "An AI agent that needs market data",
  research: "Market research and dashboards",
  product_at_scale: "A product serving many users",
  blockchain_rpc: "Blockchain RPC for my app",
};

// Must mirror the API's USE_CASES (the API rejects anything else).
export const USE_CASE_TASKS: Record<string, string[]> = {
  automated_trading: ["market-data", "agent-access", "spend"],
  ai_agent: ["agent-access", "market-data", "add-money"],
  research: ["market-data", "spend", "add-money"],
  product_at_scale: ["agent-access", "add-money", "spend"],
  blockchain_rpc: ["rpc", "agent-access", "add-money"],
};

export const TASKS: Record<string, { title: string; body: string; href: string }> = {
  "market-data": { title: "Get market data", body: "Funding rates, open interest, order books — pick a market, see the price, get a chart.", href: "/data" },
  "agent-access": { title: "Give my software access", body: "Create a key for an app or agent, choose what it can use and set a monthly limit.", href: "/agents/new" },
  "add-money": { title: "Add money", body: "Choose a plan or a credit pack, or top up with USDT.", href: "/billing/add" },
  spend: { title: "See what I've spent", body: "This month, per agent, what's left and when it resets.", href: "/spend" },
  rpc: { title: "Make a blockchain call", body: "Polygon RPC over HTTPS — your endpoint, a first request, and what it costs.", href: "/rpc" },
};

/** Visible steps (payment is part of Review from the customer's point of view). */
export function visibleSteps(legacy: boolean, paid: boolean) {
  if (legacy) return ["Account", "Before you start"];
  return paid ? ["Account", "Name", "Use", "Plan", "Review", "Before you start"] : ["Account", "Name", "Use", "Plan", "Before you start"];
}
export function stepIndex(step: OnboardingStep, legacy: boolean, paid: boolean) {
  const order: OnboardingStep[] = legacy ? ["account", "safety"] : paid ? ["account", "name", "use", "plan", "review", "safety"] : ["account", "name", "use", "plan", "safety"];
  const s = step === "payment" ? "review" : step;
  return Math.max(0, order.indexOf(s));
}
