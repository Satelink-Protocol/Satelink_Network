// Mutation guard for console route handlers: same-origin (CSRF) + a live
// Better Auth session. Every mutation is logged as an audit line (no secrets).
import { NextResponse } from "next/server";
import { getSession, type Session } from "./session";

const ALLOWED = new Set(
  (process.env.CONSOLE_ORIGINS || "https://console.satelink.network,http://localhost:3400")
    .split(",")
    .map((s) => s.trim()),
);

export async function guard(req: Request): Promise<{ session: Session } | { error: NextResponse }> {
  const origin = req.headers.get("origin");
  if (!origin || !ALLOWED.has(origin)) {
    return { error: NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403 }) };
  }
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 }) };
  return { session };
}

export function audit(session: Session, action: string, detail: Record<string, string | number | boolean> = {}) {
  console.log(JSON.stringify({ audit: "console", at: new Date().toISOString(), user: session.user.id, action, ...detail }));
}
