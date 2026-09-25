import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { accountsEnabled } from "@/lib/account";
import { loadCatalog, loadKeys, loadPlan } from "@/lib/v2";
import { AddMoneyFlow } from "@/components/v2/AddMoneyFlow";

export const metadata: Metadata = { title: "Add money" };

export default async function AddMoneyPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  if (!accountsEnabled()) redirect("/billing");
  const { checkout } = await searchParams;
  const [catalog, keys, plan] = await Promise.all([loadCatalog(), loadKeys(), loadPlan()]);
  return (
    <AddMoneyFlow
      catalog={catalog}
      keys={keys.ok ? keys.data.filter((k) => k.status === "active").map((k) => ({ id: k.id, label: k.label, hint: k.hint, balanceUsdt: k.balanceUsdt })) : []}
      plan={plan.ok ? plan.data : null}
      returned={checkout === "done"}
    />
  );
}
