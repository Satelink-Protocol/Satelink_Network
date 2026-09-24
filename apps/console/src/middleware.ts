import { NextResponse, type NextRequest } from "next/server";

// Cheap presence check only — pages and route handlers verify the session with
// the API (src/lib/session.ts). Unauthenticated visitors go to /sign-in.
const SESSION_COOKIES = ["__Secure-satelink.session_token", "satelink.session_token"];

export function middleware(req: NextRequest) {
  const has = SESSION_COOKIES.some((n) => req.cookies.get(n)?.value);
  if (has) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!sign-in|api/identity|api/console/upstream|_next|favicon|icon|robots).*)"],
};
