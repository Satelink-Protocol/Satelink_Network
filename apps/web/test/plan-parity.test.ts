// Plan parity (§4.4) — the plan/rate-card config in lib/plans.ts must stay
// consistent with the live catalog and the documented constants. The full
// page↔backend parity (GET /v1/plans) lands with Track B (P3.B); until then this
// locks the web config so a catalog move can't silently drift the pricing page.
import { describe, it, expect } from "vitest";
import { getFallbackCatalog } from "@/lib/intelligence";
import { FLAT_RATE_USD } from "@/lib/products";
import { PLANS, AGENT_RATE_CARD, CREDIT_PACKS, COMPARE_GROUPS } from "@/lib/plans";

const catalog = getFallbackCatalog();

describe("plan parity (§4.4)", () => {
  it("rate card RPC price equals the flat per-call rate", () => {
    const rpc = AGENT_RATE_CARD.find((r) => /rpc/i.test(r.product));
    expect(rpc?.price).toBe(FLAT_RATE_USD);
  });

  it("rate card Trading-Intelligence price equals the live catalog metric price", () => {
    const catalogTi = catalog.metrics[0]?.priceUsd ?? 0.01;
    const tiRows = AGENT_RATE_CARD.filter((r) => !/rpc/i.test(r.product));
    for (const row of tiRows) expect(row.price, row.product).toBe(catalogTi);
  });

  it("plan overage is below the $0.01 list rate and Max is cheaper than Pro", () => {
    const pro = PLANS.find((p) => p.id === "pro")!;
    const max = PLANS.find((p) => p.id === "max")!;
    expect(pro.overagePerCall!).toBeLessThan(0.01);
    expect(max.overagePerCall!).toBeLessThan(pro.overagePerCall!);
    expect(pro.effectivePerCall!).toBeLessThan(0.01);
    expect(max.effectivePerCall!).toBeLessThan(pro.effectivePerCall!);
  });

  it("included calls increase Free < Pro < Max", () => {
    const [free, pro, max] = ["free", "pro", "max"].map((id) => PLANS.find((p) => p.id === id)!);
    expect(free.includedCalls).toBeLessThan(pro.includedCalls);
    expect(pro.includedCalls).toBeLessThan(max.includedCalls);
  });

  it("non-live credit packs are >= $10 (the $0.40 base fee stays < 5%)", () => {
    for (const pack of CREDIT_PACKS) {
      if (!pack.live) expect(pack.price, pack.label).toBeGreaterThanOrEqual(10);
    }
  });

  it("every compare row has exactly one value per plan", () => {
    for (const group of COMPARE_GROUPS) {
      for (const row of group.rows) {
        expect(row.values.length, `${group.group} / ${row.label}`).toBe(PLANS.length);
      }
    }
  });
});
