// Client-safe account types.
export type AccountKey = {
  id: number;
  label: string;
  role: "owner" | "agent";
  hint: string;
  fingerprint: string;
  tier: string;
  status: string;
  balanceUsdt: number;
  dailyLimit: number | null;
  lastUsed: string | null;
  createdAt: string;
  linkedAt: string;
  limits: { paused: boolean; scopes: string[] | null; dailyCapUsdt: number | null; monthlyCapUsdt?: number | null };
};

export type AccountSettings = {
  monthlySpendCapUsdt: number | null;
  creditAutoUse: boolean;
  alertThresholds: number[];
  defaultMode: "simple" | "advanced";
  timezone: string;
  notifications: Record<string, boolean>;
};

