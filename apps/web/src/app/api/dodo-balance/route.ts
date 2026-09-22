// apps/web/src/app/api/dodo-balance/route.ts
// POST /api/dodo-balance — server-side proxy for the success page's balance
// poll. Two reasons this exists instead of the browser calling
// api.satelink.network/credits/balance directly:
//   1. api.satelink.network has no CORS headers on /credits/balance — a
//      direct cross-origin browser fetch fails silently (the fetch() promise
//      rejects, so a naive try/catch just treats it as "still waiting"
//      forever). Proxying server-side sidesteps browser CORS entirely.
//   2. T-1.4: the api_key must never appear in a URL, including a same-
//      origin one — this takes it in a POST body and forwards it to
//      apps/api as the X-Api-Key header, never a query string.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  (process.env.NODE_ENV === "production"
    ? "https://api.satelink.network"
    : "http://localhost:8080");

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }

  const apiKey = typeof (body as { apiKey?: unknown })?.apiKey === "string"
    ? (body as { apiKey: string }).apiKey.trim()
    : "";
  if (!apiKey || !apiKey.startsWith("sk_")) {
    return NextResponse.json({ ok: false, error: "valid_apiKey_required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${INTERNAL_API_URL}/credits/balance`, {
      headers: { "x-api-key": apiKey },
    });
    if (res.status === 404) {
      return NextResponse.json({ ok: false, error: "no_account" }, { status: 404 });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[dodo-balance] upstream failed:", res.status, text.slice(0, 300));
      return NextResponse.json({ ok: false, error: "balance_lookup_failed" }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("[dodo-balance] request failed:", (err as Error).message);
    return NextResponse.json({ ok: false, error: "balance_lookup_failed" }, { status: 502 });
  }
}
