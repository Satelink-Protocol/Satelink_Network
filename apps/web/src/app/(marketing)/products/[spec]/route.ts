// GET /products/{slug}.json — the machine-readable product contract (§12,
// schema ProductJson). A dynamic sibling of the static product page folders:
// Next resolves /products/machine-commerce (page) to the static folder first,
// and only /products/<x>.json (no static folder) reaches this route handler.
import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/intelligence";
import { buildProductJson } from "@/lib/machine";
import { PRODUCTS, type ProductSlug } from "@/lib/products";

export const revalidate = 300;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spec: string }> }) {
  const { spec } = await params;
  if (!spec.endsWith(".json")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const slug = spec.slice(0, -".json".length) as ProductSlug;
  if (!(slug in PRODUCTS)) {
    return NextResponse.json({ error: "unknown_product" }, { status: 404 });
  }
  const { catalog } = await getCatalog();
  return NextResponse.json(buildProductJson(slug, catalog), {
    headers: { "cache-control": "public, max-age=300, s-maxage=300" },
  });
}
