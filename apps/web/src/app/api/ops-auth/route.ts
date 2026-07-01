// POST /api/ops-auth
//
// Validates an operations token against ADMIN_TOKEN and, on success, sets the
// httpOnly 'ops-session' cookie that gates app/ops/*. The token itself is never
// stored in the cookie — the cookie is only an authenticated session marker.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

export async function POST(req: Request) {
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
