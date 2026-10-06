import type { Metadata } from "next";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { LEGAL_PLACEHOLDERS, RISK } from "@/lib/trading-agent/copy";
import { LegalPlaceholder, TaCards, TaHeader } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { title: "Risk — Trading Agent", robots: { index: false, follow: false } };

export default function Page() {
  requireSiteTradingAgent();
  return (
    <>
      <TaHeader title={RISK.title} lede="Trading can lose money. These controls limit what the software can do; they cannot remove market risk." />
      <TaCards items={RISK.controls} />
      <div className="mt-8"><LegalPlaceholder {...LEGAL_PLACEHOLDERS[0]} /></div>
    </>
  );
}
