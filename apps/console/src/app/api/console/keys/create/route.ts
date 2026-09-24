import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api";
import { audit, guard } from "@/lib/guard";
import { fingerprint, getKeys, MAX_KEYS, saveKeys, setActive } from "@/lib/keys";

// Issues a real free-tier key via POST /api/keys (the existing self-serve path)
// and connects it. The full key is returned ONCE to the browser to copy.
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => ({}));
  const label = String(body.label || "").trim().slice(0, 40);
  if (!label) return NextResponse.json({ ok: false, error: "name_required" }, { status: 400 });
  const keys = await getKeys();
  if (keys.length >= MAX_KEYS) return NextResponse.json({ ok: false, error: "too_many_keys" }, { status: 400 });
  const r = await apiFetch<{ ok: boolean; api_key: string; tier: string }>("/api/keys", {
    method: "POST",
    body: { tier: "free", email: g.session.user.email, email_consent: false },
  });
  if (!r.ok || !r.data.api_key) {
    return NextResponse.json({ ok: false, error: r.ok ? "no_key_returned" : r.error }, { status: r.ok ? 502 : r.status || 502 });
  }
  const key = r.data.api_key;
  await saveKeys([...keys, { k: key, label, addedAt: new Date().toISOString() }]);
  await setActive(fingerprint(key));
  audit(g.session, "key.create", { key: fingerprint(key), tier: r.data.tier });
  return NextResponse.json({ ok: true, key, tier: r.data.tier, fingerprint: fingerprint(key) });
}
