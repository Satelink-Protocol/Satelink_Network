// Client-safe Console V2 types + helpers (no server imports).
import type { AccountKey, AccountSettings } from "./account-types";
export type { AccountKey, AccountSettings };

export type PlanCatalog = {
  version: string;
  unit: { name: string; symbol: string; usd_list_value: number };
  windows: { session_hours: number; week_starts: string };
  plans: {
    id: string; name: string; kind: "free" | "subscription"; priceUsd: number; interval: string | null; basePlanId?: string | null; entitlementPlanId?: string;
    intro: { amountUsd: number; days: number; copy: string } | null;
    allowance: { sessionUu: number; weeklyUu: number; sessionHours: number; sessionTiRequests: number; weeklyTiRequests: number; weeklyListValueUsd: number };
    limits: { api_keys: number; machines: number };
    inrPrice: number | null; purchasable: boolean; economicsGate: "pass" | "fail";
  }[];
  packs: { id: string; name: string; priceUsd: number; grantUu: number; tiRequests: number; inrPrice: number | null; purchasable: boolean }[];
};

export type AccountPlan = {
  catalogVersion: string;
  plan: { id: string; status: string; periodEnd: string | null };
  subscription: { planId: string; status: string; renewsAt: string | null; intro: boolean } | null;
  windows: {
    session: { usedUu: number; capUu: number; hours: number; resetsAt: string | null };
    weekly: { usedUu: number; capUu: number; resetsAt: string; timezone: string };
  };
  packBalanceUu: number;
  thisMonth: { packUu: number; creditsUsdt: number };
};

export type Spend = {
  monthSpentUsdt: number; todaySpentUsdt: number; monthRequests: number;
  perKey: { id: number; monthUsdt: number; todayUsdt: number; monthRequests: number }[];
  caps: { timezone: string; monthlySpendCapUsdt: number | null; monthCountedUsdt: number | null };
};

export type UsageSeries = { days: number; keys: { id: number; label: string; points: { date: string; requests: number; spentUsdt: number }[] }[] };

export type RequestLog = {
  items: { at: string; product: string; method: string | null; chain: string | null; status: string; costUsdt: number; receiptId: string | null; key: { id: number; label: string; hint: string } }[];
  nextCursor: string | null;
};

export type IntelCatalog = { metrics: { metric: string; price_usdt: number; kind: string; description: string }[] };

/** Plain words for a metric id. */
export const METRIC_WORDS: Record<string, { title: string; question: string; unit: string }> = {
  "funding-rate-heatmap": { title: "Funding rates across exchanges", question: "What are traders paying to hold positions, exchange by exchange?", unit: "annualised %" },
  "open-interest-shifts": { title: "Open interest changes", question: "Is money moving into or out of this market?", unit: "% change" },
  "liquidation-clusters": { title: "Liquidation pressure (model)", question: "At which prices would leveraged positions be forced to close?", unit: "price" },
  "market-microstructure": { title: "Spread and order-book depth", question: "How tight and how deep is the market right now?", unit: "basis points" },
};

export const usd = (n: number, dp = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const pct = (used: number, cap: number) => (cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0);
