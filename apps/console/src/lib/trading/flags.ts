// Stage 25 — agent-first console flags (server-only; read from the console's own env).
//   CONSOLE_AGENT_IA=true          → agent-first navigation + /trading/* pages (default off ⇒ today's console)
//   CONSOLE_REVENUE_ADMIN_IDS=a,b  → Better Auth user ids allowed to see the admin-only Revenue page.
//     Interim until staff auth exists (B-02/B-03): the page shows no revenue data anyway (Stage 20 stopped).
export function agentIaEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CONSOLE_AGENT_IA === "true";
}

export function isRevenueAdmin(userId: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!userId) return false;
  const ids = (env.CONSOLE_REVENUE_ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(userId);
}

/** Stage 29: trace-viewer URL template (server-side only), e.g. https://grafana…/explore?…{traceId}… */
export function traceUrlTemplate(env: Record<string, string | undefined> = process.env): string | null {
  return env.CONSOLE_TRACE_URL_TEMPLATE ?? null;
}
