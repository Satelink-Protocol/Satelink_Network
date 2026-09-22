// Zod schemas for the typed content layer.
//
// Two families:
//  (1) The machine-readable product/pricing contract emitted at
//      /products/[slug].json and /pricing.json (§12) — generated from the live
//      catalog, never hand-typed.
//  (2) Shared CMS document field primitives (SEO, GEO, publish status) that the
//      Payload collections in Phase 4 conform to. Kept minimal here; collection
//      shapes are fleshed out alongside the CMS.
import { z } from "zod";

// ---- (1) Machine-readable product/pricing contract (§12) ----

export const PaymentRail = z.enum([
  "dodo_card_upi",
  "x402_usdc_base",
  "usdt_polygon",
  "credit_pack",
]);
export type PaymentRail = z.infer<typeof PaymentRail>;

export const PriceLine = z.object({
  metric: z.string(),
  unit: z.string(), // "call", "bundle", …
  price: z.number().nonnegative(),
  currency: z.string().default("USD"),
});
export type PriceLine = z.infer<typeof PriceLine>;

export const ProductJson = z.object({
  product: z.string(), // slug
  endpoint: z.string().url().optional(),
  discovery: z.string().url().optional(),
  pricing: z.array(PriceLine),
  auth: z.array(z.enum(["api_key", "x402"])),
  payment_rails: z.array(z.string()),
  rate_limits: z.string().optional(),
  docs: z.string().url().optional(),
  example_request: z.string().optional(),
  after_402: z.string().optional(),
});
export type ProductJson = z.infer<typeof ProductJson>;

export const PricingJson = z.object({
  generatedAt: z.string(), // ISO
  source: z.string().url(),
  products: z.array(
    z.object({
      slug: z.string(),
      label: z.string(),
      prices: z.array(PriceLine),
    })
  ),
});
export type PricingJson = z.infer<typeof PricingJson>;

// ---- (2) Shared CMS document primitives (§13) ----

export const PublishStatus = z.enum(["draft", "review", "scheduled", "published", "archived"]);
export type PublishStatus = z.infer<typeof PublishStatus>;

export const SeoFields = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  ogTitle: z.string().optional(),
  ogDescription: z.string().optional(),
  ogImage: z.string().optional(),
  canonical: z.string().optional(),
  schemaType: z.string().optional(),
  noindex: z.boolean().optional(),
});
export type SeoFields = z.infer<typeof SeoFields>;

// GEO / answer-engine layer (§12): the answer-first entity block + key facts.
export const GeoFields = z.object({
  entityDefinition: z.string().max(400).optional(), // ≤ ~50 words
  keyFacts: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
});
export type GeoFields = z.infer<typeof GeoFields>;

// Common envelope every public API/CMS read returns (§4).
export const Envelope = z.object({
  ok: z.boolean(),
  ts: z.string().optional(),
});
export function dataEnvelope<T extends z.ZodTypeAny>(data: T) {
  return Envelope.extend({ data });
}
