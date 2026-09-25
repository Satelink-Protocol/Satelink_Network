// Server-side client for the Satelink API. Every console number comes from
// here — a failed call returns { ok: false } and the widget renders a designed
// empty/error state; nothing is ever defaulted to a made-up value.

export const API_BASE = process.env.SATELINK_API_BASE || "https://api.satelink.network";
const UA = "Mozilla/5.0 (compatible; SatelinkConsole/1.0; +https://console.satelink.network)";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function apiFetch<T>(
  path: string,
  opts: { key?: string; cookie?: string; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; revalidate?: number; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
  if (opts.key) headers["X-API-Key"] = opts.key;
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  Object.assign(headers, opts.headers || {});
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      ...(opts.revalidate ? { next: { revalidate: opts.revalidate } } : { cache: "no-store" as const }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, error: "non_json_response" };
    }
    if (!res.ok) {
      const err = (json as { error?: string })?.error || `http_${res.status}`;
      return { ok: false, status: res.status, error: String(err) };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.name : "fetch_failed" };
  }
}

// ---- Response shapes (only the fields the console reads) ----

export type ConsoleSummary = {
  ok: true;
  data: {
    apiKey: string;
    balanceUsd: number;
    tier: string | null;
    plan: string;
    subscription: { plan: string; status: string; currentPeriodEnd: string | null } | null;
    entitlement: Record<string, unknown> | null;
    usage: { callsToday: number; callsThisMonth: number } | null;
  };
};

export type UsageHistory = { ok: true; usage: { date: string; request_count: number | string; usdt_spent: number | string }[] };
export type Deposits = { ok: true; deposits: { tx_hash: string; amount_usdt: number | string; created_at: string }[] };
export type KeyUsage = { ok: true; [k: string]: unknown };
