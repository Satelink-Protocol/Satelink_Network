import { NextResponse } from "next/server";
import { accountsEnabled } from "@/lib/account";
import { API_BASE } from "@/lib/api";
import { authCookieHeader, getSession } from "@/lib/session";

export async function GET(req: Request) {
  if (!accountsEnabled() || !(await getSession())) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("keyId"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "bad_key" }, { status: 400 });
  // /v1/me/keys/:id/deposit-info returns the upstream body verbatim (not the {ok,data} envelope).
  const r = await fetch(`${API_BASE}/v1/me/keys/${id}/deposit-info`, { headers: { Cookie: await authCookieHeader(), Accept: "application/json" }, cache: "no-store" }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  return NextResponse.json(j && r?.ok ? { ok: true, ...j } : { ok: false, error: "unavailable" }, { status: r?.ok ? 200 : 502 });
}
