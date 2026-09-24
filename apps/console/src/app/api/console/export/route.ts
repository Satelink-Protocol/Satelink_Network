import { NextResponse } from "next/server";
import { loadKey } from "@/lib/data";
import { audit } from "@/lib/guard";
import { fingerprint, getKeys } from "@/lib/keys";
import { getSession } from "@/lib/session";

// GET /api/console/export — a JSON download of everything this console holds or
// reads about the signed-in user: profile, connected keys (fingerprints only),
// and each key's summary, daily usage and deposits. Same-site GET navigation;
// the session cookie is required.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const keys = await getKeys();
  const perKey = await Promise.all(
    keys.map(async (k) => {
      const d = await loadKey(k.k);
      return { key: fingerprint(k.k), label: k.label, connectedAt: k.addedAt, summary: d.summary, dailyUsage: d.days, deposits: d.deposits };
    }),
  );
  audit(session, "data.export", { keys: keys.length });
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), profile: session.user, keys: perKey }, null, 2);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="satelink-console-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
