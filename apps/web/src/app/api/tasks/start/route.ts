// apps/web/src/app/api/tasks/start/route.ts
// POST /api/tasks/start
//
// Handles the plain-HTML-form submit from /tasks: validates City/Category/
// Email, writes a pending_payment row to task_orders (order_ref = a fresh
// UUID), then redirects the buyer to the Dodo Payments checkout link with
// the order_ref carried as a metadata_ query param — Dodo's Query Collector
// persists metadata_* params through checkout and surfaces them at
// event.data.metadata in the payment.succeeded webhook, which is how
// /api/dodo-webhook matches the payment back to this row (with a same-email
// fallback documented there, since the exact static-link metadata behavior
// isn't confirmed against a live account yet).
//
// Isolated surface: writes ONLY to task_orders. No apps/api code, no
// api_credits, no ledger_entries.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createPendingOrder } from "@/lib/task-orders/db";
import { isTasksProductEnabled } from "@/lib/tasks-product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function backToFormWithError(req: Request, error: string): NextResponse {
  const url = new URL("/tasks", req.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  // Flag-gated (default OFF) — same reasoning as /tasks/page.tsx.
  if (!isTasksProductEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return backToFormWithError(req, "invalid_form");
  }

  const city = String(form.get("city") || "").trim();
  const category = String(form.get("category") || "").trim();
  const email = String(form.get("email") || "").trim();

  if (!city || city.length > 100) return backToFormWithError(req, "invalid_city");
  if (!category || category.length > 100) return backToFormWithError(req, "invalid_category");
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return backToFormWithError(req, "invalid_email");
  }

  const checkoutLink = process.env.DODO_CHECKOUT_LINK;
  if (!checkoutLink) {
    // Dodo account/product not set up yet — fail loudly and visibly rather
    // than silently writing an order nobody can ever pay for.
    return NextResponse.json(
      { ok: false, error: "DODO_CHECKOUT_LINK not configured" },
      { status: 503 }
    );
  }

  const orderRef = randomUUID();

  try {
    await createPendingOrder({ orderRef, city, category, buyerEmail: email });
  } catch (err) {
    console.error("[tasks/start] failed to write pending order:", err);
    return backToFormWithError(req, "order_failed");
  }

  const checkoutUrl = new URL(checkoutLink);
  checkoutUrl.searchParams.set("metadata_order_ref", orderRef);
  checkoutUrl.searchParams.set("metadata_city", city);
  checkoutUrl.searchParams.set("metadata_category", category);

  return NextResponse.redirect(checkoutUrl, 303);
}
