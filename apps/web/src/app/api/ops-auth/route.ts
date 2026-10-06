// POST /api/ops-auth
//
// Validates an operations token against ADMIN_TOKEN and, on success, sets the
// httpOnly 'ops-session' cookie that gates app/ops/*. The token itself is never
// stored in the cookie — the cookie is only an authenticated session marker.
//
// Gate 0 B-03 (2026-10-07): the cookie it sets is an unsigned "1", so it never
// proved anything, and this endpoint was an ADMIN_TOKEN guessing oracle. It
// now 404s unless the admin UI gate passes (OFF — see src/lib/admin-ui-gate.ts).
import { NextResponse } from "next/server";
import { adminUiAllowed, notFoundResponse } from "@/lib/admin-ui-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

export async function POST(req: Request) {
  if (!adminUiAllowed(req)) return notFoundResponse();
  const expected = process.env.ADMIN_TOKEN || "";

  let token = "";
  try {
    const body = await req.json();
    token = typeof body?.token === "string" ? body.token : "";
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set("ops-session", "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
