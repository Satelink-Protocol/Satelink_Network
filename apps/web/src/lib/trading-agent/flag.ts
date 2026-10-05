// Stage 26 — the Trading Agent public pages are flag-gated (SITE_TRADING_AGENT, default OFF):
// with the flag off every /trading-agent/* route is a 404 and nothing links there. Server-only var.
import { notFound } from "next/navigation";

export function siteTradingAgentEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SITE_TRADING_AGENT === "true";
}

export function requireSiteTradingAgent(): void {
  if (!siteTradingAgentEnabled()) notFound();
}
