// apps/web/src/app/api/dodo-claim/route.ts
// POST /api/dodo-claim — the ONLY way the success page learns the buyer's
// api_key (T-1.4 security fix). Takes the opaque claim token from the
// return_url's ?claim= param (never the key itself) and exchanges it
// server-side, exactly once, via apps/api's /internal/dodo/exchange-claim.
// The key is returned in this response BODY, never placed in a URL again —
// the browser's own fetch() call here doesn't add it to history, and a JSON
// POST body isn't logged the way a query string is.
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

  const claimToken = typeof (body as { claimToken?: unknown })?.claimToken === "string"
    ? (body as { claimToken: string }).claimToken.trim()
    : "";
  if (!claimToken) {
    return NextResponse.json({ ok: false, error: "claimToken_required" }, { status: 400 });
  }

  const secret = process.env.DODO_INTERNAL_SECRET;
  if (!secret) {
    console.error("[dodo-claim] DODO_INTERNAL_SECRET is not set");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${INTERNAL_API_URL}/internal/dodo/exchange-claim`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dodo-internal-secret": secret },
      body: JSON.stringify({ claimToken }),
    });
    if (res.status === 410) {
      return NextResponse.json({ ok: false, error: "claim_invalid_expired_or_used" }, { status: 410 });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[dodo-claim] exchange-claim failed:", res.status, text.slice(0, 300));
      return NextResponse.json({ ok: false, error: "exchange_failed" }, { status: 502 });
    }
    const data = (await res.json()) as { ok?: boolean; apiKey?: string };
    if (!data?.apiKey) {
      return NextResponse.json({ ok: false, error: "exchange_failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, apiKey: data.apiKey });
  } catch (err) {
    console.error("[dodo-claim] request failed:", (err as Error).message);
    return NextResponse.json({ ok: false, error: "exchange_failed" }, { status: 502 });
  }
}
