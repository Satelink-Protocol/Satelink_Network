import type { Metadata } from "next";
import { Disclosure } from "@satelink/web-ui/ui";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { AI } from "@/lib/trading-agent/copy";
import { AI_NOTE, TaHeader } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { title: "AI — Trading Agent", robots: { index: false, follow: false } };

export default function Page() {
  requireSiteTradingAgent();
  return (
    <>
      <TaHeader title={AI.title} />
      <Disclosure title="AI disclosure" className="mb-6">{AI_NOTE}</Disclosure>
      <table className="w-full text-left text-sm">
        <thead><tr><th className="py-2 pr-4">The agent…</th><th className="py-2">Allowed?</th></tr></thead>
        <tbody>{AI.rows.map(([a, b]) => <tr key={a} className="border-t border-sl-border"><td className="py-2 pr-4">{a}</td><td className="py-2">{b}</td></tr>)}</tbody>
      </table>
    </>
  );
}
