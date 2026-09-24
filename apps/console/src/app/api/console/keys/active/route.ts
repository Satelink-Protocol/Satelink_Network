import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { fingerprint, getKeys, setActive } from "@/lib/keys";

export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const { fp } = await req.json().catch(() => ({}));
  const keys = await getKeys();
  if (!keys.some((x) => fingerprint(x.k) === fp)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await setActive(String(fp));
  return NextResponse.json({ ok: true });
}
