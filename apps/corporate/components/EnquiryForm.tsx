"use client";

import { useState } from "react";

const TOPICS = ["General", "Partnerships", "Trade & distribution", "Satelink", "Press", "Grievance"];
const field = "mt-1.5 w-full rounded-lg border border-stone-2 bg-ivory px-3.5 py-2.5 text-ink placeholder:text-stone-3 focus:border-green focus:outline-none";

export function EnquiryForm({ fallbackEmail }: { fallbackEmail: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "unavailable">("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const r = await fetch("/api/enquiry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setState(r.ok ? "sent" : r.status === 503 ? "unavailable" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="rounded-2xl border border-stone-1 bg-green-soft p-8">
        <p className="font-serif text-2xl text-green">Thank you — your message is on its way.</p>
        <p className="mt-2 text-stone-4">A confirmation has been sent to your email address.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate={false}>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm">
          Name
          <input name="name" required autoComplete="name" className={field} />
        </label>
        <label className="block text-sm">
          Email
          <input name="email" type="email" required autoComplete="email" className={field} />
        </label>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm">
          Organisation <span className="text-stone-3">(optional)</span>
          <input name="organisation" autoComplete="organization" className={field} />
        </label>
        <label className="block text-sm">
          Topic
          <select name="topic" className={field} defaultValue="General">
            {TOPICS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        Message
        <textarea name="message" required minLength={10} rows={6} className={field} />
      </label>
      <div aria-hidden="true" className="hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={state === "sending"} className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-ivory hover:bg-green disabled:opacity-60">
          {state === "sending" ? "Sending…" : "Send enquiry"}
        </button>
        <p className="text-sm text-stone-3">We use your details only to reply. See our <a href="/legal/privacy" className="link-u">privacy notice</a>.</p>
      </div>
      {(state === "error" || state === "unavailable") && (
        <p role="alert" className="rounded-lg bg-amber-soft px-4 py-3 text-sm text-amber-ink">
          {state === "unavailable" ? "The form is not accepting messages right now." : "Something went wrong sending your message."} Please email{" "}
          <a href={`mailto:${fallbackEmail}`} className="underline">{fallbackEmail}</a> directly.
        </p>
      )}
    </form>
  );
}
