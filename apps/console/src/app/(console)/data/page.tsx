import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { accountsEnabled } from "@/lib/account";
import { loadIntelCatalog, loadKeys, loadPlan } from "@/lib/v2";
import { DataFlow } from "@/components/v2/DataFlow";

export const metadata: Metadata = { title: "Get market data" };

export default async function DataPage() {
  if (!accountsEnabled()) redirect("/trading-intelligence");
  const [catalog, keys, plan] = await Promise.all([loadIntelCatalog(), loadKeys(), loadPlan()]);
  return (
    <DataFlow
      metrics={catalog?.metrics ?? []}
      keys={keys.ok ? keys.data.filter((k) => k.status === "active" && !k.limits.paused && (!k.limits.scopes || k.limits.scopes.includes("intelligence"))).map((k) => ({ id: k.id, label: k.label, hint: k.hint, balanceUsdt: k.balanceUsdt })) : []}
      plan={plan.ok ? plan.data : null}
    />
  );
}
