// Per-request log page for the logs panel (session → /v1/me/requests).
import { NextResponse } from "next/server";
import { accountsEnabled, me } from "@/lib/account";
import { getSession } from "@/lib/session";
import type { RequestLog } from "@/lib/v2";

const ALLOWED = ["keyId", "product", "status", "from", "to", "limit", "cursor"];

export async function GET(req: Request) {
  if (!accountsEnabled() || !(await getSession())) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ALLOWED) { const v = src.get(k); if (v) qs.set(k, v.slice(0, 120)); }
  const r = await me<RequestLog>(`/requests?${qs}`);
  return r.ok ? NextResponse.json({ ok: true, data: r.data }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status || 502 });
}
