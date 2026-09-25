// Free symbol list for a metric (names only) — lets a person choose a market
// before paying. Proxies the public API from the server (Cloudflare blocks
// Vercel→api fetches; SATELINK_API_BASE points at the origin).
import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api";
import { getSession } from "@/lib/session";

export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const metric = new URL(req.url).searchParams.get("metric") || "";
  if (!/^[a-z-]{3,40}$/.test(metric)) return NextResponse.json({ ok: false, error: "bad_metric" }, { status: 400 });
  const r = await apiFetch<{ ok: true; symbols: string[]; exchanges: string[]; price_usdt: number; as_of: string }>(`/v1/intelligence/${metric}/universe`, { revalidate: 60 });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ ok: false, error: r.error }, { status: r.status || 502 });
}
