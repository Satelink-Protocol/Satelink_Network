// POST /api/support-feedback — "Was this helpful?" votes from support articles
// (§7 SupportArticleTemplate → HelpfulVotes). Native HTML form POST (form-
// encoded), so we read formData and 303-redirect back to the article. Persists
// via structured logging today; when the CMS is wired this creates a Feedback
// record. No PII is collected — only the article id and yes/no.
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`support-feedback:${ip}`, 30, 1);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let article = "";
  let helpful = "";
  try {
    const form = await req.formData();
    article = String(form.get("article") ?? "").slice(0, 200);
    helpful = String(form.get("helpful") ?? "").slice(0, 8);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_form" }, { status: 400 });
  }

  if (helpful !== "yes" && helpful !== "no") {
    return NextResponse.json({ ok: false, error: "invalid_vote" }, { status: 400 });
  }

  // TODO(cms-feedback): create a Feedback record when CMS_API_URL is set.
  console.log("[support-feedback]", JSON.stringify({ ts: new Date().toISOString(), article, helpful }));

  // Return the reader to where they came from with a thank-you flag.
  const referer = req.headers.get("referer");
  const back = referer && referer.startsWith(req.nextUrl.origin) ? `${referer.split("#")[0]}#thanks` : "/support";
  return NextResponse.redirect(new URL(back, req.nextUrl.origin), 303);
}
