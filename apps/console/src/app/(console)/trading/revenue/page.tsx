import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { requireAgentIa } from "@/lib/trading/guard";
import { isRevenueAdmin } from "@/lib/trading/flags";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Revenue (admin)" };

export default async function RevenuePage() {
  requireAgentIa();
  const session = await getSession();
  if (!isRevenueAdmin(session?.user.id)) notFound(); // admin-only; customers get a plain 404
  return (
    <>
      <PageHeader title="Revenue" lede="Admin only." />
      <Panel title="Trading revenue">
        <Empty title="Revenue booking is paused" body="No trading revenue is booked: the revenue stage is stopped pending a founder decision. Broker commission is tracked only in a simulated book (Alpaca stage). Nothing here is a real figure." />
      </Panel>
    </>
  );
}
