// Server-side account data (CONSOLE_ACCOUNTS_V1). With the flag on, the console
// reads everything through the signed-in session → API → key ids, so the same
// account shows the same keys, usage and billing in every browser. No key is
// held in this browser: the per-browser `slc_keys` cookie is only read once, to
// offer moving its keys onto the account, and is then deleted.
import { apiFetch, type ApiResult } from "./api";
import { authCookieHeader } from "./session";

export function accountsEnabled() {
  return process.env.CONSOLE_ACCOUNTS_V1 === "true";
}

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
  limits: { paused: boolean; scopes: string[] | null; dailyCapUsdt: number | null };
};

export type AccountSettings = {
  monthlySpendCapUsdt: number | null;
  creditAutoUse: boolean;
  alertThresholds: number[];
  defaultMode: "simple" | "advanced";
  timezone: string;
  notifications: Record<string, boolean>;
};

type Envelope<T> = { ok: true; data: T };

/** GET /v1/me/<path> as the signed-in user. */
export async function me<T>(path: string): Promise<ApiResult<T>> {
  const cookie = await authCookieHeader();
  const r = await apiFetch<Envelope<T>>(`/v1/me${path}`, { cookie });
  return r.ok ? { ok: true, data: r.data.data } : r;
}

/** Mutation as the signed-in user; adds the API's CSRF header. */
export async function meMutate<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<ApiResult<T> & { replayed?: boolean }> {
  const cookie = await authCookieHeader();
  const headers: Record<string, string> = { "X-Satelink-Console": "1" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const r = await apiFetch<Envelope<T>>(`/v1/me${path}`, { cookie, method, body: body ?? (method === "DELETE" ? undefined : {}), headers });
  return r.ok ? { ok: true, data: r.data.data } : r;
}
