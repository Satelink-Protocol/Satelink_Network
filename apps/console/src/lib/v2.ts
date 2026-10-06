// Console V2 data layer: account-scoped reads (session → API /v1/me) plus the
// public PlanCatalog and Trading Intelligence catalogue. Every number shown in
// the console comes from one of these; failures render designed empty states.
import { apiFetch } from "./api";
import { me } from "./account";
import type { AccountPlan, AlertsState, IntelCatalog, PlanCatalog, RequestLog, Spend, UsageSeries } from "./v2-shared";
import type { AccountKey, AccountSettings } from "./account-types";

export * from "./v2-shared";

/** The PlanCatalog as the signed-in account may buy it (/v1/me/catalog: in Dodo
 *  TEST mode only allowlisted founder emails see purchasable items). If that
 *  read fails, the public catalog is shown with every paid item "Available
 *  soon" — never purchasable by default. */
export async function loadCatalog() {
  const mine = await me<PlanCatalog>("/catalog");
  if (mine.ok) return mine.data;
  const r = await apiFetch<{ ok: true; data: PlanCatalog }>("/v2/plans", { revalidate: 60 });
  if (!r.ok) return null;
  const c = r.data.data;
  return {
    ...c,
    checkoutAvailable: false,
    plans: c.plans.map((p) => ({ ...p, purchasable: false, availability: p.kind === "free" ? "free" : "soon" })),
    packs: c.packs.map((k) => ({ ...k, purchasable: false, availability: "soon" })),
  } as PlanCatalog;
}
export async function loadIntelCatalog() {
  const r = await apiFetch<IntelCatalog>("/v1/intelligence", { revalidate: 300 });
  return r.ok ? r.data : null;
}
export const loadPlan = () => me<AccountPlan>("/plan");
export const loadSettings = () => me<AccountSettings>("/settings");
export const loadKeys = () => me<AccountKey[]>("/keys");
export const loadSpend = () => me<Spend>("/spend");
export const loadUsage = (days = 30) => me<UsageSeries>(`/usage?days=${days}`);
export const loadRequests = (qs = "limit=200") => me<RequestLog>(`/requests?${qs}`);
export const loadAlerts = () => me<AlertsState>("/alerts");

