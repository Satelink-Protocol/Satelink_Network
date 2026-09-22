// Machine-readable contract builders (§12). Generated from the product facts +
// the live catalog — never hand-typed JSON. Feeds /products/{slug}.json,
// /pricing.json, /.well-known/satelink.json, and the llms.txt generators.
import type { ProductJson, PricingJson, PriceLine } from "@satelink/content";
import { SITES, DISCOVERY } from "@satelink/content";
import type { Catalog } from "@/lib/intelligence";
import { PRODUCTS, PRODUCT_ORDER, FLAT_RATE_USD, X402_BUNDLE, type ProductSlug } from "@/lib/products";

const SITE = SITES.satelink.origin;

/** Live-or-documented price lines for a product. */
function priceLinesFor(slug: ProductSlug, catalog: Catalog): PriceLine[] {
  if (slug === "trading-intelligence") {
    return catalog.metrics.map((m) => ({ metric: m.slug, unit: "call", price: m.priceUsd, currency: "USD" }));
  }
  if (slug === "x402") {
    return [{ metric: "rpc-bundle", unit: `${X402_BUNDLE.calls} calls`, price: X402_BUNDLE.priceUsd, currency: "USD" }];
  }
  // machine-commerce, rpc, metering — the flat per-call rate.
  return [{ metric: "call", unit: "call", price: FLAT_RATE_USD, currency: "USD" }];
}

const RAIL_LABEL: Record<string, string> = {
  credits: "usdt_polygon (credit balance)",
  x402: "x402_usdc_base",
  usdt: "usdt_polygon",
  dodo: "dodo_card_upi (credit pack)",
};

export function buildProductJson(slug: ProductSlug, catalog: Catalog): ProductJson {
  const p = PRODUCTS[slug];
  return {
    product: slug,
    endpoint: p.endpoint,
    discovery: p.discovery ?? DISCOVERY.wellKnown,
    pricing: priceLinesFor(slug, catalog),
    auth: p.auth,
    payment_rails: p.rails.map((r) => RAIL_LABEL[r.id] ?? r.id),
    docs: p.docs,
    example_request: p.exampleRequest,
    after_402: "Read the machine-readable requirements in the 402 response, pay via the chosen rail (x402, USDT deposit, or credits), then retry the request.",
  };
}

export function buildPricingJson(catalog: Catalog): PricingJson {
  return {
    generatedAt: new Date().toISOString(),
    source: DISCOVERY.catalog,
    products: PRODUCT_ORDER.map((slug) => ({
      slug,
      label: PRODUCTS[slug].name,
      prices: priceLinesFor(slug, catalog),
    })),
  };
}

/** The local /.well-known/satelink.json — points machines at the live rails. */
export function buildWellKnown(catalog: Catalog) {
  return {
    name: "Satelink",
    description: "Machine commerce infrastructure — discover, pay, and settle for API calls.",
    site: SITE,
    services: PRODUCT_ORDER.map((slug) => ({ product: slug, url: `${SITE}${PRODUCTS[slug].href}`, spec: `${SITE}/products/${slug}.json` })),
    discovery: DISCOVERY.wellKnown,
    catalog: DISCOVERY.catalog,
    pricing: `${SITE}/pricing.json`,
    payments: ["x402", "usdt", "credits"],
    generatedAt: new Date().toISOString(),
  };
}

/** Input for the llms.txt generators. */
export function buildLlmsInput(catalog: Catalog) {
  return {
    products: PRODUCT_ORDER.map((slug) => ({
      slug,
      label: PRODUCTS[slug].name,
      summary: PRODUCTS[slug].definition,
      prices: priceLinesFor(slug, catalog),
    })),
    docs: [
      { title: "Documentation", url: SITES.docs.origin },
      { title: "Quickstart", url: `${SITE}/developers/quickstart` },
      { title: "API surface", url: `${SITE}/developers/api` },
      { title: "Pricing", url: `${SITE}/pricing` },
      { title: "Platform", url: `${SITE}/platform` },
    ],
  };
}
