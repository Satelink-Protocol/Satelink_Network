import type { Metadata } from "next";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { SECURITY } from "@/lib/trading-agent/copy";
import { TaCards, TaHeader } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { title: "Security — Trading Agent", robots: { index: false, follow: false } };

export default function Page() {
  requireSiteTradingAgent();
  return (<><TaHeader title={SECURITY.title} /><TaCards items={SECURITY.items} /></>);
}
