import type { Metadata } from "next";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { TradingDisclosure } from "@/components/trading/parts";
import { requireAgentIa } from "@/lib/trading/guard";

export const metadata: Metadata = { title: "Executions" };

export default function ExecutionsPage() {
  requireAgentIa();
  return (
    <>
      <PageHeader title="Executions" lede="Every fill your broker reports, with price and fee." />
      <Panel title="Fills"><Empty title="Not available yet" body="The fills list is still being built. Each order's page shows how much was filled." cta={{ label: "Go to orders", href: "/trading/orders" }} /></Panel>
      <TradingDisclosure />
    </>
  );
}
