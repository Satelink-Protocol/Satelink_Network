// The public /pricing page renders from the SAME PlanCatalog the API serves at
// /v2/plans and the console Billing page reads: apps/api/config/plan_catalog.v2.json,
// shaped by the API's own publicCatalog(). One source, one formula — parity by
// construction (guarded by test/plan-catalog-parity.test.ts).
import catalogJson from "../../../api/config/plan_catalog.v2.json";
// @ts-expect-error — plain ESM module from apps/api, no type declarations.
import { publicCatalog as apiPublicCatalog } from "../../../api/src/pricing_v2/catalog.mjs";

export type PublicPlan = {
  id: string; name: string; kind: "free" | "subscription"; priceUsd: number; interval: string | null;
  intro: { amountUsd: number; days: number; copy: string } | null;
  allowance: { sessionUu: number; weeklyUu: number; sessionHours: number; sessionTiRequests: number; weeklyTiRequests: number; weeklyListValueUsd: number };
  limits: { api_keys: number; machines: number };
  inrPrice: number | null; purchasable: boolean; economicsGate: "pass" | "fail";
};
export type PublicPack = { id: string; name: string; priceUsd: number; grantUu: number; tiRequests: number; inrPrice: number | null; purchasable: boolean };
export type PublicCatalog = { version: string; unit: { name: string; symbol: string; usd_list_value: number }; boundary: string; windows: { session_hours: number }; plans: PublicPlan[]; packs: PublicPack[] };

/** mode: which Dodo product ids decide "purchasable" (test until live is switched on). */
export function planCatalog(mode: "test" | "live" = process.env.DODO_MODE === "live" ? "live" : "test"): PublicCatalog {
  return apiPublicCatalog(catalogJson, { mode }) as PublicCatalog;
}

export const CONSOLE = "https://console.satelink.network";
