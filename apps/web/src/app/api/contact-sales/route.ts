// POST /api/contact-sales — Enterprise / sales enquiry intake (§8, §12).
// Mirrors /api/corporate-enquiry: zod validation, honeypot, per-IP rate limit.
// Persists via structured logging today; when the CMS is wired (CMS_API_URL),
// this is where an Enquiries record is created. No transactional email provider
// is configured in apps/web (verified 2026-09-22), so we log + return success
// per §6's fallback. The destination inbox is never returned to the client.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  company: z.string().min(1).max(160),
  role: z.string().max(120).optional().default(""),
  useCase: z.string().min(1).max(80),
  volume: z.string().min(1).max(80),
  message: z.string().max(4000).optional().default(""),
  consent: z.literal(true),
  website: z.string().max(0).optional().default(""), // honeypot
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`contact-sales:${ip}`, 5, 5 / 60);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Honeypot: silently accept so bots get no signal.
  if (typeof (body as { website?: unknown })?.website === "string" && (body as { website: string }).website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "validation_failed", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { name, email, company, role, useCase, volume, message } = parsed.data;
  // TODO(cms-enquiries): create an Enquiries record when CMS_API_URL is set.
  console.log("[contact-sales]", JSON.stringify({ ts: new Date().toISOString(), ip, name, email, company, role, useCase, volume, messageLen: message.length }));

  return NextResponse.json({ ok: true });
}
