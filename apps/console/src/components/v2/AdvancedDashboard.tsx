import { loadKeys, loadPlan, loadRequests, loadSpend, loadUsage } from "@/lib/v2";
import { me } from "@/lib/account";
import { DashboardGrid, type DashData } from "./DashboardGrid";

// Advanced mode: server-loads every free panel's data for the chosen range; the
// client grid handles layout, template variables, auto-refresh and the paid
// market panels (run only on an explicit click).
export async function AdvancedDashboard({ range = "30d" }: { range?: string }) {
  const days = range === "90d" ? 90 : range === "7d" ? 7 : range === "24h" || range === "1h" ? 1 : 30;
  const fromSec = Math.floor(Date.now() / 1000) - ({ "1h": 3600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400 } as Record<string, number>)[range];
  const [keys, usage, spend, plan, requests, saved] = await Promise.all([
    loadKeys(), loadUsage(Math.max(days, 2)), loadSpend(), loadPlan(), loadRequests(`limit=200&from=${fromSec || ""}`),
    me<{ id: number; name: string; query: { kind?: string; panels?: { id: string; w: number }[] } }[]>("/saved-queries"),
  ]);
  const layout = saved.ok ? saved.data.find((q) => q.name === "__layout:advanced") : null;
  const data: DashData = {
    range,
    keys: keys.ok ? keys.data.map((k) => ({ id: k.id, label: k.label, hint: k.hint, balanceUsdt: k.balanceUsdt, scopes: k.limits.scopes })) : null,
    usage: usage.ok ? usage.data : null,
    spend: spend.ok ? spend.data : null,
    plan: plan.ok ? plan.data : null,
    requests: requests.ok ? requests.data : null,
    layout: layout?.query?.panels ?? null,
    layoutId: layout?.id ?? null,
  };
  return <DashboardGrid data={data} />;
}
