// Parity: satelink.network/pricing, the API's /v2/plans and the console Billing
// page all render the SAME PlanCatalog. The web adapter must equal the API's
// publicCatalog() output for the shipped config, field for field.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planCatalog } from "../src/lib/plan-catalog";
// @ts-expect-error — plain ESM from apps/api
import { publicCatalog } from "../../api/src/pricing_v2/catalog.mjs";

const json = JSON.parse(readFileSync(resolve(__dirname, "..", "..", "api", "config", "plan_catalog.v2.json"), "utf8"));

describe("PlanCatalog parity (web /pricing ≡ API /v2/plans ≡ console Billing)", () => {
  it("web adapter equals the API's publicCatalog for the shipped config", () => {
    expect(planCatalog("test")).toEqual(publicCatalog(json, { mode: "test" }));
  });
  it("the pricing page carries no hard-coded plan numbers from the old model", () => {
    const page = readFileSync(resolve(__dirname, "..", "src", "app", "(marketing)", "pricing", "page.tsx"), "utf8");
    for (const legacy of ["2,500", "12,000", "300 Trading", "includedCalls", "overage"]) expect(page).not.toContain(legacy);
  });
  it("Launch shows the intro copy the brief requires", () => {
    expect(planCatalog("test").plans.find((p) => p.id === "launch")?.intro?.copy).toBe("$5 for your first month. Renews at $19/month.");
  });
});
