import { NextResponse } from "next/server";
import { company } from "@/content/company";

// Business enquiry form → email to the company inbox + auto-reply to the sender,
// both sent via Resend from the verified jakuraa.com domain. If RESEND_API_KEY
// is not configured the route answers 503 and the form shows the direct email
// address instead — it never pretends a message was delivered.

const TOPICS = ["General", "Partnerships", "Trade & distribution", "Satelink", "Press", "Grievance"] as const;
const hits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function send(key: string, body: Record<string, unknown>) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`resend ${r.status}`);
}

export async function POST(req: Request) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  if (typeof data.website === "string" && data.website) return NextResponse.json({ ok: true }); // honeypot

  const name = String(data.name || "").trim().slice(0, 120);
  const email = String(data.email || "").trim().slice(0, 200);
  const organisation = String(data.organisation || "").trim().slice(0, 160);
  const topic = TOPICS.includes(data.topic as (typeof TOPICS)[number]) ? String(data.topic) : "General";
  const message = String(data.message || "").trim().slice(0, 5000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 10) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const from = process.env.ENQUIRY_FROM || "Jakuraa <no-reply@jakuraa.com>";
  const to = process.env.ENQUIRY_TO || company.email;
  try {
    await send(key, {
      from,
      to,
      reply_to: email,
      subject: `[Enquiry · ${topic}] ${name}${organisation ? ` — ${organisation}` : ""}`,
      html: `<p><b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(email)}<br><b>Organisation:</b> ${esc(organisation || "—")}<br><b>Topic:</b> ${esc(topic)}</p><p>${esc(message).replace(/\n/g, "<br>")}</p>`,
    });
    await send(key, {
      from,
      to: email,
      subject: "We received your message — Jakuraa",
      html: `<p>Hello ${esc(name)},</p><p>Thank you for writing to ${esc(company.legalName)}. We have received your ${esc(topic.toLowerCase())} enquiry and will reply from ${esc(company.email)}.</p><p>— Jakuraa</p>`,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
