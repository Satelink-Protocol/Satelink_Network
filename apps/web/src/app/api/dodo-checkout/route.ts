// apps/web/src/app/api/dodo-checkout/route.ts
// POST /api/dodo-checkout — creates a Dodo Payments checkout session for a
// one-time credit-pack purchase, replacing the old static payment-link buy
// buttons on /intelligence.
//
// Identity mapping (T-1.4, the reason this route exists): a checkout
// session's payload has no natural link back to a Satelink account — Dodo's
// webhook payload carries whatever `metadata` the session was created with,
// nothing else. This route is that link: it resolves-or-creates an api_key
// for the buyer's email via apps/api's /internal/dodo/resolve-account
// (apps/web's DB role has no grants on api_credits — see dodo-webhook's
// module header), embeds it as metadata.satelink_account_id, and only THEN
// creates the session. The webhook (dodo-webhook/route.ts) later reads that
// exact field back and credits ONLY that account — no email guessing, no
// silent account creation on the money-crediting path.
import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession } from "@dodopayments/core/checkout";
import { getDodoClientConfig } from "@/lib/dodo/environment";
import { findCreditPack } from "@/lib/dodo/credit-packs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  (process.env.NODE_ENV === "production"
    ? "https://api.satelink.network"
    : "http://localhost:8080");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Deliberately throws on any non-2xx/network failure — the caller decides
// the HTTP status to return to the browser; this must never silently return
// a made-up api_key.
async function resolveAccount(email: string): Promise<string> {
  const secret = process.env.DODO_INTERNAL_SECRET;
  if (!secret) {
    throw new Error("[dodo-checkout] DODO_INTERNAL_SECRET is not set — cannot resolve an account");
  }
  const res = await fetch(`${INTERNAL_API_URL}/internal/dodo/resolve-account`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dodo-internal-secret": secret },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[dodo-checkout] resolve-account failed: ${res.status} ${text}`.slice(0, 500));
  }
  const data = (await res.json()) as { ok?: boolean; apiKey?: string };
  if (!data?.apiKey) {
    throw new Error("[dodo-checkout] resolve-account returned no apiKey");
  }
  return data.apiKey;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }

  const { email: rawEmail, productId: rawProductId } = (body || {}) as {
    email?: unknown;
    productId?: unknown;
  };
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const productId = typeof rawProductId === "string" ? rawProductId.trim() : "";

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "valid_email_required" }, { status: 400 });
  }
  const pack = findCreditPack(productId);
  if (!pack) {
    return NextResponse.json({ ok: false, error: "unknown_or_unconfigured_product" }, { status: 400 });
  }

  let apiKey: string;
  try {
    apiKey = await resolveAccount(email);
  } catch (err) {
    console.error("[dodo-checkout] account resolution failed:", (err as Error).message);
    return NextResponse.json({ ok: false, error: "account_resolution_failed" }, { status: 502 });
  }

  let dodoConfig: ReturnType<typeof getDodoClientConfig>;
  try {
    dodoConfig = getDodoClientConfig();
  } catch (err) {
    console.error("[dodo-checkout]", (err as Error).message);
    return NextResponse.json({ ok: false, error: "dodo_not_configured" }, { status: 503 });
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://satelink.network").replace(/\/+$/, "");

  try {
    const session = await createCheckoutSession(
      {
        product_cart: [{ product_id: pack.productId, quantity: 1 }],
        customer: { email },
        metadata: { satelink_account_id: apiKey },
        return_url: `${siteUrl}/intelligence/success?account=${encodeURIComponent(apiKey)}`,
      },
      dodoConfig
    );

    if (!session.checkout_url) {
      console.error("[dodo-checkout] createCheckoutSession returned no checkout_url", { sessionId: session.session_id });
      return NextResponse.json({ ok: false, error: "no_checkout_url" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, checkoutUrl: session.checkout_url });
  } catch (err) {
    console.error("[dodo-checkout] createCheckoutSession failed:", (err as Error).message);
    return NextResponse.json({ ok: false, error: "checkout_session_failed" }, { status: 502 });
  }
}
