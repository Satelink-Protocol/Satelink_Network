"use client";
// Contact-sales enquiry form. Posts JSON to /api/contact-sales (zod-validated,
// honeypot, rate-limited). The honeypot field is visually hidden but submitted.
// No destination inbox is exposed client-side.
import * as React from "react";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

type State = "idle" | "submitting" | "ok" | "error";

export function ContactSalesForm() {
  const [state, setState] = React.useState<State>("idle");
  const [errorMsg, setErrorMsg] = React.useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("submitting");
    setErrorMsg("");
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      company: String(fd.get("company") ?? ""),
      role: String(fd.get("role") ?? ""),
      useCase: String(fd.get("useCase") ?? ""),
      volume: String(fd.get("volume") ?? ""),
      message: String(fd.get("message") ?? ""),
      consent: fd.get("consent") === "on",
      website: String(fd.get("website") ?? ""),
    };
    try {
      const res = await fetch("/api/contact-sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setState("error");
        setErrorMsg(res.status === 429 ? "Too many requests — please try again shortly." : "Something went wrong. Please try again.");
        return;
      }
      setState("ok");
    } catch {
      setState("error");
      setErrorMsg("Network error. Please try again.");
    }
  }

  if (state === "ok") {
    return (
      <div className="rounded-[var(--sl-radius-lg)] border border-sl-up/40 bg-sl-up/10 p-6">
        <p className="font-semibold text-sl-text">Thanks — we&rsquo;ve got your enquiry.</p>
        <p className="mt-1 text-sm text-sl-text-muted">A member of the team will reply to the email you provided.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor="name"><Input id="name" name="name" required maxLength={120} /></Field>
      <Field label="Work email" htmlFor="email"><Input id="email" name="email" type="email" required maxLength={200} /></Field>
      <Field label="Company" htmlFor="company"><Input id="company" name="company" required maxLength={160} /></Field>
      <Field label="Role" htmlFor="role"><Input id="role" name="role" maxLength={120} /></Field>
      <Field label="Primary use case" htmlFor="useCase">
        <Select id="useCase" name="useCase" required defaultValue="">
          <option value="" disabled>Select…</option>
          <option>Machine commerce</option>
          <option>Trading Intelligence</option>
          <option>RPC</option>
          <option>API monetization</option>
          <option>Other</option>
        </Select>
      </Field>
      <Field label="Expected volume" htmlFor="volume">
        <Select id="volume" name="volume" required defaultValue="">
          <option value="" disabled>Select…</option>
          <option>&lt; 100k calls / mo</option>
          <option>100k–1M calls / mo</option>
          <option>1M–10M calls / mo</option>
          <option>&gt; 10M calls / mo</option>
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="What are you building?" htmlFor="message"><Textarea id="message" name="message" rows={4} maxLength={4000} /></Field>
      </div>
      {/* Honeypot — visually hidden, still submitted. */}
      <div className="invisible absolute h-0 w-0 overflow-hidden" aria-hidden>
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="sm:col-span-2">
        <Checkbox id="consent" name="consent" required label="I agree to be contacted about my enquiry and accept the privacy policy." />
      </div>
      {state === "error" && <p className="sm:col-span-2 text-sm text-sl-down">{errorMsg}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" size="lg" disabled={state === "submitting"}>
          {state === "submitting" ? "Sending…" : "Send enquiry"}
        </Button>
      </div>
    </form>
  );
}
