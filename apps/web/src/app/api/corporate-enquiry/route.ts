// POST /api/corporate-enquiry — Corporate Services enquiry intake.
// Validates with zod, rejects honeypot hits, rate-limits per IP. There is no
// transactional email provider configured in apps/web and no apps/api contact
// endpoint (verified 2026-09-22), so per §6's fallback this persists the
// enquiry via structured server logging and returns success. TODO(email):
// wire Resend or an apps/api endpoint (see docs/web/DECISIONS.md). The
// destination address (satelinknetwork@gmail.com) is never returned to the
// client — it stays server-side.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EnquirySchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  company: z.string().min(1).max(160),
  role: z.string().max(120).optional().default(""),
  useCase: z.string().min(1).max(80),
  volume: z.string().min(1).max(80),
  message: z.string().max(4000).optional().default(""),
  consent: z.literal(true),
  // honeypot — must be empty; bots fill it.
  website: z.string().max(0).optional().default(""),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`corp-enquiry:${ip}`, 5, 5 / 60);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Honeypot: silently accept (200) so bots get no signal, but do not process.
  if (typeof (body as { website?: unknown })?.website === "string" && (body as { website: string }).website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const parsed = EnquirySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { name, email, company, role, useCase, volume, message } = parsed.data;

  // Persist (structured log). A durable sink (email/DB) is the follow-up.
  console.log(
    "[corporate-enquiry]",
    JSON.stringify({
      ts: new Date().toISOString(),
      ip,
      name,
      email,
      company,
      role,
      useCase,
      volume,
      messageLen: message.length,
    })
  );

  return NextResponse.json({ ok: true });
}
