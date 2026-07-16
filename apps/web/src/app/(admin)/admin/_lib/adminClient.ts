// Shared client for the admin dashboard → /api/admin-proxy → backend /admin/*.
//
// ENVELOPE NORMALIZATION (important)
// Two response shapes exist on the backend:
//   • OBSERVER endpoints (Phase 9) wrap their payload: { ok, data: {...}, ts }
//   • Older endpoints return fields flat alongside ok: { ok, summary, ... }
// adminGet returns the payload for both — `.data` when present, else the whole
// object minus the envelope. Consumers never have to know which kind they hit.

async function call<T>(path: string, method: "GET" | "PATCH" | "POST", body?: unknown): Promise<T | null> {
  try {
    const res = await fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, method, body }),
    });
    const json = await res.json();
    if (!json?.ok) return null;
    return (json.data !== undefined ? json.data : json) as T;
  } catch {
    return null;
  }
}

export function adminGet<T = any>(path: string): Promise<T | null> {
  return call<T>(path, "GET");
}

export function adminPatch<T = any>(path: string, body: unknown): Promise<T | null> {
  return call<T>(path, "PATCH", body);
}
