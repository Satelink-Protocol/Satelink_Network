// ops.satelink.network — internal operations console.
//
// Gate 0 B-03 (2026-10-07): this layout used to admit any request carrying a
// non-empty 'ops-session' or 'x-admin-token' cookie — trivially forgeable.
// There is no signed, server-verified staff session in apps/web yet, so the
// whole /ops tree now 404s unless the admin UI gate passes (see
// src/lib/admin-ui-gate.ts, which is OFF until such a session exists).
// middleware.ts applies the same gate first; this is defense in depth.
import { notFound } from "next/navigation";
import { adminUiAllowed } from "@/lib/admin-ui-gate";

export default function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!adminUiAllowed()) notFound();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">{children}</div>
  );
}
