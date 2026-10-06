// Admin UI gate (Gate 0 B-02/B-03 hotfix, 2026-10-07).
//
// One deny-by-default switch for every staff-only surface in apps/web:
// /api/admin-proxy, /api/grafana/*, /api/ops-auth, /ops/*, /admin/* and the
// admin./ops. subdomains (see SECURITY_HOTFIX.md).
//
// A surface is reachable only when BOTH hold:
//   1. ADMIN_UI_ENABLED === "true" (unset = off), and
//   2. the request carries a server-verified staff session.
//
// apps/web has NO server-verifiable staff session today: the 'ops-session'
// cookie is an unsigned literal "1" that anyone can set, and the (admin)
// layout decodes a localStorage JWT client-side without verifying it. Until a
// signed, server-verified mechanism exists, hasVerifiedStaffSession() returns
// false, so every gated surface stays OFF even with ADMIN_UI_ENABLED=true.
// Do not loosen this to a cookie-presence check.
//
// Edge-safe: no Node-only APIs (imported by middleware).

export function adminUiEnabled(): boolean {
  return process.env.ADMIN_UI_ENABLED === "true";
}

export function hasVerifiedStaffSession(_req?: Request): boolean {
  return false;
}

export function adminUiAllowed(req?: Request): boolean {
  return adminUiEnabled() && hasVerifiedStaffSession(req);
}

export function notFoundResponse(): Response {
  return new Response("Not Found", { status: 404 });
}

// Paths and hosts gated by middleware (page routes; /api/* is excluded from
// the middleware matcher, so API routes gate themselves).
export function isGatedPagePath(pathname: string): boolean {
  return /^\/(admin|ops)(\/|$)/.test(pathname);
}

export function isGatedSubdomain(subdomain: string): boolean {
  return subdomain === "admin" || subdomain === "ops";
}

const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

// Resolves a caller-supplied admin path ("executive/summary?window=24h",
// leading slashes allowed) to `${origin}/admin/<path>`. Returns null for
// anything containing "..", encoded or not, control characters, backslashes,
// a scheme, or anything that does not land under /admin/ on the API origin.
export function resolveAdminUpstream(apiBase: string, rawPath: unknown): string | null {
  if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.length > 2048) return null;
  if (CONTROL_OR_BACKSLASH.test(rawPath) || rawPath.includes("..")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (CONTROL_OR_BACKSLASH.test(decoded) || decoded.includes("..")) return null;

  const rel = rawPath.replace(/^\/+/, "");
  if (!rel || /^[a-z][a-z0-9+.-]*:/i.test(rel)) return null;

  let origin: string;
  try {
    origin = new URL(apiBase).origin;
  } catch {
    return null;
  }
  let url: URL;
  try {
    url = new URL(`/admin/${rel}`, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || !url.pathname.startsWith("/admin/")) return null;
  return url.toString();
}

// Grafana catch-all segments: reject "..", ".", empty, or any segment that
// smuggles a separator.
export function safeGrafanaSegments(segments: string[]): boolean {
  if (segments.length === 0) return false;
  return segments.every(
    (s) => s.length > 0 && s !== "." && !s.includes("..") && !s.includes("/") && !CONTROL_OR_BACKSLASH.test(s)
  );
}
