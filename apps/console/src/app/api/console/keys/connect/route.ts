import { NextResponse } from "next/server";
import { apiFetch, type ConsoleSummary } from "@/lib/api";
import { audit, guard } from "@/lib/guard";
import { fingerprint, getKeys, MAX_KEYS, saveKeys, setActive } from "@/lib/keys";

const PREFIXES = ["sk_free", "sk_basic", "sk_pro", "sk_ent", "sk_live"];

export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => ({}));
  const key = String(body.key || "").trim();
  const label = String(body.label || "").trim().slice(0, 40) || "Connected key";
  if (!PREFIXES.some((p) => key.startsWith(p)) || key.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid_key_format" }, { status: 400 });
  }
  const keys = await getKeys();
  if (keys.some((x) => x.k === key)) return NextResponse.json({ ok: false, error: "already_connected" }, { status: 409 });
  if (keys.length >= MAX_KEYS) return NextResponse.json({ ok: false, error: "too_many_keys" }, { status: 400 });
  const check = await apiFetch<ConsoleSummary>("/v1/console/summary", { key });
  if (!check.ok) return NextResponse.json({ ok: false, error: check.status === 401 ? "key_not_recognised" : "api_unavailable" }, { status: 400 });
  await saveKeys([...keys, { k: key, label, addedAt: new Date().toISOString() }]);
  await setActive(fingerprint(key));
  audit(g.session, "key.connect", { key: fingerprint(key) });
  return NextResponse.json({ ok: true, fingerprint: fingerprint(key) });
}
