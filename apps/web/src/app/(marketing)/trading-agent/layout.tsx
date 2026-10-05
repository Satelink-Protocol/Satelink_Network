// Stage 26 — Trading Agent public pages. Flag-gated (SITE_TRADING_AGENT, default OFF ⇒ 404) and
// noindex until launch; nothing in the live navigation links here.
import type { Metadata } from "next";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { TaFrame } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function TradingAgentLayout({ children }: { children: React.ReactNode }) {
  requireSiteTradingAgent();
  return <TaFrame>{children}</TaFrame>;
}
