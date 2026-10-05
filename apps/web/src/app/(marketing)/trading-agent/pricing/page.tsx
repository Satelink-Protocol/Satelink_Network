import type { Metadata } from "next";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { LEGAL_PLACEHOLDERS, PRICING } from "@/lib/trading-agent/copy";
import { LegalPlaceholder, TaHeader } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { title: "Pricing — Trading Agent", robots: { index: false, follow: false } };

export default function Page() {
  requireSiteTradingAgent();
  return (
    <>
      <TaHeader title={PRICING.title} lede={PRICING.body} />
      <LegalPlaceholder {...LEGAL_PLACEHOLDERS[1]} />
    </>
  );
}
