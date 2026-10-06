import type { Metadata } from "next";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { TaHeader } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { title: "Log in — Trading Agent", robots: { index: false, follow: false } };

export default function Page() {
  requireSiteTradingAgent();
  return (
    <>
      <TaHeader title="Log in" lede="Satelink accounts sign in at the console. The Trading Agent is not switched on for any account yet." />
      <a className="text-sl-accent underline" href="https://console.satelink.network/sign-in">Go to the console sign-in</a>
    </>
  );
}
