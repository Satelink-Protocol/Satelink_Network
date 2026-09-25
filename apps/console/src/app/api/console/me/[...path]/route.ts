// Same-origin proxy from console client components to the API's /v1/me/*.
// The console guard (Origin + live session) runs first; only the listed
// method/path shapes are forwarded; the API applies its own CSRF + auth again.
import { NextResponse } from "next/server";
import { audit, guard } from "@/lib/guard";
import { accountsEnabled, meMutate, meRaw } from "@/lib/account";

const ALLOW: [string, RegExp][] = [
  ["POST", /^\/keys$/],
  ["POST", /^\/keys\/link$/],
  ["PATCH", /^\/keys\/\d+$/],
  ["POST", /^\/keys\/\d+\/(revoke|rotate)$/],
  ["PUT", /^\/keys\/\d+\/limits$/],
  ["PATCH", /^\/settings$/],
  ["POST", /^\/saved-queries$/],
  ["DELETE", /^\/saved-queries\/\d+$/],
  ["POST", /^\/wallets\/(challenge|verify)$/],
  ["DELETE", /^\/wallets\/0x[0-9a-fA-F]{40}$/],
  ["POST", /^\/intelligence\/[a-z-]+$/],
  ["POST", /^\/checkout$/],
  ["POST", /^\/keys\/\d+\/deposit$/],
];

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!accountsEnabled()) return NextResponse.json({ ok: false, error: "accounts_disabled" }, { status: 404 });
  const g = await guard(req);
  if ("error" in g) return g.error;
  const path = "/" + (await ctx.params).path.join("/");
  const method = req.method as "POST" | "PUT" | "PATCH" | "DELETE";
  if (!ALLOW.some(([m, re]) => m === method && re.test(path))) {
    return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 404 });
  }
  const body = method === "DELETE" ? undefined : await req.json().catch(() => ({}));
  if (path.startsWith("/intelligence/") || /^\/keys\/\d+\/deposit$/.test(path)) {
    // Metric runs return the upstream body as-is (status + payload).
    const raw = await meRaw("POST", path, body);
    audit(g.session, path.startsWith("/intelligence/") ? "me/intelligence" : "me/deposit", { target: path.split("/")[2], status: raw.status });
    return NextResponse.json(raw.body, { status: raw.status });
  }
  const r = await meMutate<unknown>(method, path, body, req.headers.get("idempotency-key") || undefined);
  audit(g.session, `me${path.replace(/\d+/g, ":id")}`, { method, ok: r.ok });
  return r.ok ? NextResponse.json({ ok: true, data: r.data }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status || 502 });
}

export { handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
