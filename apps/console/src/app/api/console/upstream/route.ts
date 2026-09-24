import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api";

// Ops probe (no auth, no data): can this console server reach the API? Used to
// monitor the Vercel → api.satelink.network path the whole console depends on.
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const r = await apiFetch<unknown>("/v1/plans");
  return NextResponse.json(
    { ok: r.ok, status: r.ok ? 200 : r.status, error: r.ok ? undefined : r.error, ms: Date.now() - started },
    { status: r.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } },
  );
}
