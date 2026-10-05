import type { Metadata } from "next";
import { Badge, Empty, PageHeader, Panel } from "@/components/ui";
import { TradingDisclosure } from "@/components/trading/parts";
import { requireAgentIa } from "@/lib/trading/guard";

export const metadata: Metadata = { title: "Strategies" };

export default function StrategiesPage() {
  requireAgentIa();
  return (
    <>
      <PageHeader title="Strategies" lede="Rules the agent follows. Each version is locked once saved, so you always know exactly what ran." />
      <Panel title="Your strategies">
        <Empty title="Not available yet" body="Listing and editing strategies here is still being built. We show nothing rather than made-up examples." />
      </Panel>
      <Panel title="How results are labelled" className="mt-4">
        <ul className="grid gap-1">
          <li><Badge tone="settle">Hypothetical</Badge> backtests on past data — not what would have happened.</li>
          <li><Badge tone="settle">Paper</Badge> simulated orders — no real money.</li>
          <li><Badge tone="warn">Live</Badge> real money — switched off for every account today.</li>
        </ul>
      </Panel>
      <TradingDisclosure />
    </>
  );
}
