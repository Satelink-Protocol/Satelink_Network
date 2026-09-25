// GET the signed-in account's onboarding state (the payment screen polls this
// while Dodo's webhook lands). Read-only; the API decides what "confirmed" is.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accountsEnabled } from "@/lib/account";
import { loadOnboarding, onboardingEnabled } from "@/lib/onboarding-server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!accountsEnabled() || !onboardingEnabled()) return NextResponse.json({ ok: false, error: "onboarding_disabled" }, { status: 404 });
  if (!(await getSession())) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const r = await loadOnboarding();
  return r.ok ? NextResponse.json({ ok: true, data: r.data }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status || 502 });
}
