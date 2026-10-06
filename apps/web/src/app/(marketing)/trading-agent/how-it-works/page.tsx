import type { Metadata } from "next";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { HOW } from "@/lib/trading-agent/copy";
import { Hypothetical, TaCards, TaHeader } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { title: "How it works — Trading Agent", robots: { index: false, follow: false } };

export default function Page() {
  requireSiteTradingAgent();
  return (
    <>
      <TaHeader title={HOW.title} />
      <TaCards items={HOW.steps} />
      <div className="mt-8">
        <Hypothetical>
          <p>Your limits allow buying up to 0.01 BTC-USDT per order. The agent suggests buying 0.001 BTC-USDT with a limit price of 30,000 USDT. You approve it with a code. The order is checked, sent once to the broker&apos;s test network, and shows as &quot;waiting for a fill&quot;. You cancel it, and the receipt shows each step.</p>
        </Hypothetical>
      </div>
    </>
  );
}
