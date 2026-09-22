// GET /pricing.json — machine-readable pricing (§12, schema PricingJson),
// generated from the live catalog + documented flat/bundle rates.
import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/intelligence";
import { buildPricingJson } from "@/lib/machine";

export const revalidate = 300;

export async function GET() {
  const { catalog } = await getCatalog();
  return NextResponse.json(buildPricingJson(catalog), {
    headers: { "cache-control": "public, max-age=300, s-maxage=300" },
  });
}
