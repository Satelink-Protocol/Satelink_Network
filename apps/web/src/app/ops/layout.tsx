// ops.satelink.network — internal operations console.
//
// Auth gate runs server-side because the session marker ('ops-session') is an
// httpOnly cookie set by /api/ops-auth and is therefore unreadable by client
// JS. We also accept an 'x-admin-token' cookie as a direct escape hatch for
// tooling / bootstrap access. (An ?ADMIN_TOKEN=… query param can't be read from
// a layout — Next.js only passes searchParams to pages — so it is not honored
// here.)
//
// The '/ops/login' route is exempt from the gate (otherwise it would redirect
// to itself in a loop). The pathname is provided by middleware via the
// 'x-ops-pathname' request header since layouts don't receive it directly.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [jar, hdrs] = await Promise.all([cookies(), headers()]);
  const pathname = hdrs.get("x-ops-pathname") || "";

  const isLoginRoute = pathname === "/ops/login" || pathname.startsWith("/ops/login/");

  const authed =
    Boolean(jar.get("ops-session")?.value) ||
    Boolean(jar.get("x-admin-token")?.value);

  if (!isLoginRoute && !authed) {
    redirect("/ops/login");
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">{children}</div>
  );
}
