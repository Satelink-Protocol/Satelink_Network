import { NextResponse } from "next/server";
import { audit, guard } from "@/lib/guard";
import { fingerprint, getKeys, saveKeys } from "@/lib/keys";

// Disconnects a key from this console. It does NOT revoke the key on the API —
// revocation needs the server-side account link (docs/console/ACCOUNT_LINKING.md).
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const { fp } = await req.json().catch(() => ({}));
  const keys = await getKeys();
  const next = keys.filter((x) => fingerprint(x.k) !== fp);
  if (next.length === keys.length) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await saveKeys(next);
  audit(g.session, "key.disconnect", { key: String(fp) });
  return NextResponse.json({ ok: true });
}
