import type { Metadata } from "next";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { CONNECTORS } from "@/lib/trading-agent/status";
import { StageBadge, TaHeader } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { title: "Brokers — Trading Agent", robots: { index: false, follow: false } };

export default function Page() {
  requireSiteTradingAgent();
  return (
    <>
      <TaHeader title="Brokers" lede="Where orders would go. Your money always stays with your broker. Status below comes from one configuration file and can only say what has been evidenced." />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr><th className="py-2 pr-4">Broker</th><th className="py-2 pr-4">Markets</th><th className="py-2 pr-4">Environment</th><th className="py-2 pr-4">How orders work</th><th className="py-2">Status</th></tr></thead>
          <tbody>
            {CONNECTORS.map((c) => (
              <tr key={c.id} className="border-t border-sl-border align-top">
                <td className="py-2 pr-4 font-medium">{c.name}</td><td className="py-2 pr-4">{c.region}</td><td className="py-2 pr-4">{c.environment}</td>
                <td className="py-2 pr-4">{c.howOrdersWork}</td><td className="py-2"><StageBadge stage={c.stage} /><p className="mt-1 text-sl-text-subtle">Next: {c.next}</p></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
