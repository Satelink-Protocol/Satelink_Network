// GET /.well-known/satelink.json — site-level machine discovery (§12). Lists
// the products + their machine-readable specs and points at the live API
// discovery/catalog on rpc.satelink.network.
import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/intelligence";
import { buildWellKnown } from "@/lib/machine";

export const revalidate = 300;

export async function GET() {
  const { catalog } = await getCatalog();
  return NextResponse.json(buildWellKnown(catalog), {
    headers: { "cache-control": "public, max-age=300, s-maxage=300" },
  });
}
