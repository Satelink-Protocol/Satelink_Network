// "Test it": checks a just-issued key against the API without spending
// anything (the console summary is free). The key is sent once, server-side.
import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api";
import { guard } from "@/lib/guard";

export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const { key } = await req.json().catch(() => ({ key: "" }));
  if (typeof key !== "string" || !key.startsWith("sk_") || key.length > 100) return NextResponse.json({ ok: false, error: "invalid_key" }, { status: 400 });
  const r = await apiFetch<{ ok: true; data: { tier: string | null } }>("/v1/console/summary", { key });
  return r.ok ? NextResponse.json({ ok: true, tier: r.data.data.tier }) : NextResponse.json({ ok: false, error: r.status === 401 ? "key_not_recognised" : "api_unavailable" }, { status: 200 });
}
