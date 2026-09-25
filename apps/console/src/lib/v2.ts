// Console V2 data layer: account-scoped reads (session → API /v1/me) plus the
// public PlanCatalog and Trading Intelligence catalogue. Every number shown in
// the console comes from one of these; failures render designed empty states.
import { apiFetch } from "./api";
import { me } from "./account";
import type { AccountPlan, IntelCatalog, PlanCatalog, RequestLog, Spend, UsageSeries } from "./v2-shared";
import type { AccountKey, AccountSettings } from "./account-types";

export * from "./v2-shared";

export async function loadCatalog() {
  const r = await apiFetch<{ ok: true; data: PlanCatalog }>("/v2/plans", { revalidate: 60 });
  return r.ok ? r.data.data : null;
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

