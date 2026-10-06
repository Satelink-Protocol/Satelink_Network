"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Better Auth endpoints, proxied same-origin via /api/identity (vercel.json).
async function identity(path: string, body: unknown = {}) {
  const r = await fetch(`/api/identity/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.ok;
}

// Revokes by opaque session id: the API resolves the token server-side from the
// signed-in user's own sessions, so no session token ever reaches this page.
export function RevokeSession({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded border border-sl-border px-2 py-0.5 text-[11px] hover:border-sl-down hover:text-sl-down disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        const r = await fetch(`/api/console/me/sessions/${encodeURIComponent(id)}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
        setBusy(false);
        setFailed(!r?.ok);
        if (r?.ok) router.refresh();
      }}
    >
      {failed ? "Retry revoke" : "Revoke"}
    </button>
  );
}

export function RevokeOthers() {
  const router = useRouter();
  return (
    <button type="button" className="h-7 rounded border border-sl-border px-2.5 text-xs hover:border-sl-down" onClick={async () => { await identity("revoke-other-sessions"); router.refresh(); }}>
      Sign out other devices
    </button>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <button type="button" className="h-7 rounded border border-sl-border px-2.5 text-xs" onClick={async () => { await identity("sign-out"); router.push("/sign-in"); router.refresh(); }}>
      Sign out
    </button>
  );
}
