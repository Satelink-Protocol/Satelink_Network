import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api";
import { audit, guard } from "@/lib/guard";
import { fingerprint, getActiveKey } from "@/lib/keys";

// Runs ONE real Trading Intelligence call with the active key. The UI shows the
// catalog price and asks for confirmation before calling this.
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const { metric } = await req.json().catch(() => ({}));
  if (typeof metric !== "string" || !/^[a-z0-9-]{2,64}$/.test(metric)) {
    return NextResponse.json({ ok: false, error: "invalid_metric" }, { status: 400 });
  }
  const active = await getActiveKey();
  if (!active) return NextResponse.json({ ok: false, error: "no_key" }, { status: 400 });
  const started = Date.now();
  const r = await apiFetch<unknown>(`/v1/intelligence/${metric}`, { key: active.k });
  audit(g.session, "ti.run", { key: fingerprint(active.k), metric, status: r.ok ? 200 : r.status });
  return NextResponse.json({ ok: r.ok, status: r.ok ? 200 : r.status, ms: Date.now() - started, body: r.ok ? r.data : { error: r.error } });
}
