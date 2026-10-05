// Stage 25 — server-side client for the Stage 24 /v1/trading API. Runs only on the console server:
// it forwards the signed-in user's Better Auth cookie; no key, token or secret reaches the browser
// (layer 4). Mutations carry Idempotency-Key + X-Satelink-Client (the API's CSRF rule).
import { API_BASE } from "../api";
import { authCookieHeader } from "../session";

export type TradingResult<T> = { ok: true; data: T; status: number; replayed: boolean } | { ok: false; status: number; code: string | null; message: string | null };

async function call<T>(method: "GET" | "POST", path: string, opts: { body?: unknown; idempotencyKey?: string; stepUp?: string } = {}): Promise<TradingResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json", Cookie: await authCookieHeader() };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-Satelink-Client"] = "1";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts.stepUp) headers["X-Satelink-Step-Up"] = opts.stepUp;
  }
  try {
    const res = await fetch(`${API_BASE}/v1/trading${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null;
    if (res.ok && json?.ok) return { ok: true, data: json.data as T, status: res.status, replayed: res.headers.get("idempotent-replayed") === "true" };
    return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? null };
  } catch {
    return { ok: false, status: 0, code: null, message: null };
  }
}

export const tradingGet = <T>(path: string) => call<T>("GET", path);
export const tradingPost = <T>(path: string, body: unknown, opts: { idempotencyKey: string; stepUp?: string }) => call<T>("POST", path, { body, ...opts });
