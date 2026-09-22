// apps/web/src/lib/dodo/credit-packs.ts
//
// The one-time credit-pack catalog rendered on /intelligence and used to
// build the Dodo checkout session's product_cart. Config-driven (no
// hardcoded product ids/prices) so it never has to guess a Dodo dashboard
// value — same principle as DODO_PRODUCT_PRO_ID/STARTER_ID in
// apps/api/src/routes/internal_dodo.js. Mirrors the product ids configured
// server-side in apps/api's DODO_CREDIT_PACK_USD_VALUES — the two must list
// the SAME product ids or a purchase will succeed on Dodo but land in
// unmatched_payments (wrong/missing allowlist entry) rather than crediting.
//
// Format: "productId:usdValue:Label,productId2:usdValue2:Label2"
// Example: "pdt_abc123:9.99:Starter Pack,pdt_def456:49.99:Growth Pack"
//
// Public (NEXT_PUBLIC_) because product ids and list prices are not secret —
// they're visible in the Dodo checkout page itself.

export type CreditPack = {
  productId: string;
  usdValue: number;
  label: string;
};

function parseCreditPacks(raw: string | undefined): CreditPack[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [productId, usdValueRaw, ...labelParts] = entry.split(":");
      const usdValue = Number(usdValueRaw);
      return {
        productId: (productId || "").trim(),
        usdValue: Number.isFinite(usdValue) ? usdValue : NaN,
        label: labelParts.join(":").trim() || (productId || "").trim(),
      };
    })
    .filter((p) => p.productId && Number.isFinite(p.usdValue) && p.usdValue > 0);
}

export function getCreditPacks(): CreditPack[] {
  return parseCreditPacks(process.env.NEXT_PUBLIC_DODO_CREDIT_PACKS);
}

export function findCreditPack(productId: string): CreditPack | undefined {
  return getCreditPacks().find((p) => p.productId === productId);
}

// Map a human `plan` slug from /checkout?plan=<slug> to a configured pack.
// "starter" → the $9.99 pack (matched by label containing "starter", else the
// $9.99 value, else the first configured pack). Returns undefined only when no
// packs are configured at all (env unset) — the checkout page renders an
// "unavailable" state in that case rather than guessing a price.
export function findPackByPlan(plan: string): CreditPack | undefined {
  const packs = getCreditPacks();
  if (!packs.length) return undefined;
  const p = (plan || "").trim().toLowerCase();
  if (p === "starter" || p === "") {
    return (
      packs.find((x) => x.label.toLowerCase().includes("starter")) ??
      packs.find((x) => x.usdValue === 9.99) ??
      packs[0]
    );
  }
  // Other plans: match by label slug.
  return packs.find((x) => x.label.toLowerCase().includes(p)) ?? undefined;
}
