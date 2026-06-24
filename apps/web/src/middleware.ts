import { NextRequest, NextResponse } from "next/server";

/**
 * Redirect the admin subdomain root to the command center.
 * admin.satelink.network/  ->  admin.satelink.network/admin/command-center
 *
 * Only runs on "/" (see config.matcher), so it never interferes with other routes.
 */
export function middleware(request: NextRequest) {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];

  if (hostname.startsWith("admin.") && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/command-center";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
