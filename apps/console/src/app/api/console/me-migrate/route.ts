// One-time move of the keys this browser holds (httpOnly `slc_keys` cookie,
// pre-accounts console) onto the signed-in account. Each key is linked with
// its possession proof (the key itself, sent server-to-server once). Keys that
// link — or were already on this account — leave the cookie; a key linked to a
// different account stays and is reported, never silently dropped.
import { NextResponse } from "next/server";
import { audit, guard } from "@/lib/guard";
import { accountsEnabled, meMutate } from "@/lib/account";
import { fingerprint, getKeys, saveKeys } from "@/lib/keys";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  if (!accountsEnabled()) return NextResponse.json({ ok: false, error: "accounts_disabled" }, { status: 404 });
  const g = await guard(req);
  if ("error" in g) return g.error;
  const keys = await getKeys();
  const results: { key: string; outcome: "linked" | "already_linked" | "linked_elsewhere" | "invalid" | "error" }[] = [];
  const keep = [];
  for (const k of keys) {
    const r = await meMutate<{ alreadyLinked: boolean }>("POST", "/keys/link", { apiKey: k.k, label: k.label });
    const outcome = r.ok ? (r.data.alreadyLinked ? "already_linked" : "linked")
      : r.error === "key_linked_elsewhere" ? "linked_elsewhere" : r.error === "invalid_key" ? "invalid" : "error";
    results.push({ key: fingerprint(k.k), outcome });
    if (outcome === "linked_elsewhere" || outcome === "error") keep.push(k);
  }
  if (keep.length) await saveKeys(keep);
  else {
    const jar = await cookies();
    jar.delete("slc_keys");
    jar.delete("slc_active");
  }
  audit(g.session, "keys.migrate", { total: keys.length, kept: keep.length });
  return NextResponse.json({ ok: true, results, retired: keep.length === 0 });
}
