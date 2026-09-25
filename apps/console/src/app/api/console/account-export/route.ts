// Account data export (CONSOLE_ACCOUNTS_V1): everything /v1/me holds for you, as a download.
import { NextResponse } from "next/server";
import { accountsEnabled, me } from "@/lib/account";
import { getSession } from "@/lib/session";

export async function GET() {
  if (!accountsEnabled() || !(await getSession())) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const r = await me<unknown>("/export");
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  return new NextResponse(JSON.stringify(r.data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="satelink-account-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" },
  });
}
