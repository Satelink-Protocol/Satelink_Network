import type { Metadata } from "next";
import { Badge } from "@satelink/web-ui/ui";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { CONNECTORS, PLATFORM } from "@/lib/trading-agent/status";
import { StageBadge, TaHeader } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { title: "Status — Trading Agent", robots: { index: false, follow: false } };

const onOff = (on: boolean, yes: string, no: string) => <Badge variant={on ? "live" : "planned"}>{on ? yes : no}</Badge>;

export default function Page() {
  requireSiteTradingAgent();
  return (
    <>
      <TaHeader title="Status" lede="What is switched on today. This page reads the same configuration as the broker list." />
      <table className="w-full text-left text-sm">
        <tbody>
          <tr className="border-t border-sl-border"><td className="py-2 pr-4">Live trading</td><td className="py-2">{onOff(!PLATFORM.liveTradingLocked, "On", "Off for every account")}</td></tr>
          <tr className="border-t border-sl-border"><td className="py-2 pr-4">Public sign-up</td><td className="py-2">{onOff(PLATFORM.publicSignupOpen, "Open", "Not open")}</td></tr>
          <tr className="border-t border-sl-border"><td className="py-2 pr-4">Paper-trading preview</td><td className="py-2">{onOff(PLATFORM.paperPreviewOpen, "Open", "Not open")}</td></tr>
          <tr className="border-t border-sl-border"><td className="py-2 pr-4">Public API</td><td className="py-2">{onOff(PLATFORM.apiPublic, "Published", "Not published")}</td></tr>
          {CONNECTORS.map((c) => <tr key={c.id} className="border-t border-sl-border"><td className="py-2 pr-4">{c.name}</td><td className="py-2"><StageBadge stage={c.stage} /></td></tr>)}
        </tbody>
      </table>
      <p className="mt-4 text-sl-text-muted">Service uptime for the existing Satelink products is on the main status page.</p>
    </>
  );
}
