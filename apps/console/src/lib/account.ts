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

export type { AccountKey, AccountSettings } from "./account-types";

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
  extraHeaders: Record<string, string> = {},
): Promise<ApiResult<T> & { replayed?: boolean }> {
  const cookie = await authCookieHeader();
  const headers: Record<string, string> = { ...extraHeaders, "X-Satelink-Console": "1" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const r = await apiFetch<Envelope<T>>(`/v1/me${path}`, { cookie, method, body: body ?? (method === "DELETE" ? undefined : {}), headers });
  return r.ok ? { ok: true, data: r.data.data } : r;
}

/** Mutation whose upstream body is returned verbatim (no {ok,data} envelope). */
export async function meRaw(method: "POST", path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const { API_BASE } = await import("./api");
  const cookie = await authCookieHeader();
  try {
    const r = await fetch(`${API_BASE}/v1/me${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Satelink-Console": "1", Cookie: cookie, Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    return { status: r.status, body: await r.json().catch(() => ({ ok: false, error: "non_json_response" })) };
  } catch {
    return { status: 502, body: { ok: false, error: "api_unavailable" } };
  }
}
