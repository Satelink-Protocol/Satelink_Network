// Global search API (§14). Delegates to the shared search index.
import { NextResponse } from "next/server";
import { searchIndex } from "@/lib/search-index";

// Reads a runtime query param, so it must be dynamic (force-static would freeze
// the response at build time with q="").
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ hits: searchIndex(q) });
}
