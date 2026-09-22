"use client";
// Corporate enquiry form → POST /api/corporate-enquiry. Client-side validation
// mirrors the server zod schema; a hidden honeypot ("website") traps bots.
// Success shows an inline confirmation + toast; 429 shows a friendly retry.
import * as React from "react";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { CheckCircle2 } from "lucide-react";

const USE_CASES = [
  "Research desk / fund",
  "Fintech / trading tools",
  "Exchange / venue",
  "Agent framework / infra",
  "Other",
];
const VOLUMES = [
  "< 100k calls / month",
  "100k – 1M calls / month",
  "1M – 10M calls / month",
  "> 10M calls / month",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Values = {
  name: string;
  email: string;
  company: string;
  role: string;
  useCase: string;
  volume: string;
  message: string;
  consent: boolean;
  website: string; // honeypot
};

const EMPTY: Values = {
  name: "",
  email: "",
  company: "",
  role: "",
  useCase: "",
  volume: "",
  message: "",
  consent: false,
  website: "",
};

export function EnquiryForm() {
  const [v, setV] = React.useState<Values>(EMPTY);
  const [errors, setErrors] = React.useState<Partial<Record<keyof Values, string>>>({});
  const [status, setStatus] = React.useState<"idle" | "sending" | "done">("idle");

  function set<K extends keyof Values>(k: K, val: Values[K]) {
    setV((prev) => ({ ...prev, [k]: val }));
  }

  function validate(): boolean {
    const e: Partial<Record<keyof Values, string>> = {};
    if (!v.name.trim()) e.name = "Please enter your name.";
    if (!EMAIL_RE.test(v.email)) e.email = "Enter a valid work email.";
    if (!v.company.trim()) e.company = "Please enter your company.";
    if (!v.useCase) e.useCase = "Select a use case.";
    if (!v.volume) e.volume = "Select an expected volume.";
    if (!v.consent) e.consent = "Please agree to be contacted about your enquiry.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (status === "sending") return;
    if (!validate()) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/corporate-enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v),
      });
      if (res.status === 429) {
        toast.error("Too many requests — please try again in a minute.");
        setStatus("idle");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { issues?: Record<string, string[]> };
        if (data.issues) {
          const e: Partial<Record<keyof Values, string>> = {};
          for (const [k, msgs] of Object.entries(data.issues)) e[k as keyof Values] = msgs?.[0];
          setErrors(e);
        }
        toast.error("Please check the form and try again.");
        setStatus("idle");
        return;
      }
      setStatus("done");
      toast.success("Enquiry sent — we'll be in touch.");
    } catch {
      toast.error("Network error — please try again.");
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-8 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-sl-accent-soft text-sl-accent">
          <CheckCircle2 className="size-6" />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-sl-text">Thanks — your enquiry is in.</h3>
        <p className="mt-2 text-sm text-sl-text-muted">
          We read every corporate enquiry and reply within 24 hours to{" "}
          <span className="font-medium text-sl-text">{v.email}</span>. For anything urgent, email{" "}
          <a href="mailto:satelinknetwork@gmail.com" className="text-sl-accent underline">
            satelinknetwork@gmail.com
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      {/* honeypot — visually hidden, off the a11y tree */}
      <div aria-hidden className="invisible absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={v.website}
          onChange={(e) => set("website", e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="cf-name" required error={errors.name}>
          <Input id="cf-name" value={v.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} />
        </Field>
        <Field label="Work email" htmlFor="cf-email" required error={errors.email}>
          <Input id="cf-email" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!errors.email} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" htmlFor="cf-company" required error={errors.company}>
          <Input id="cf-company" value={v.company} onChange={(e) => set("company", e.target.value)} aria-invalid={!!errors.company} />
        </Field>
        <Field label="Role" htmlFor="cf-role" hint="Optional">
          <Input id="cf-role" value={v.role} onChange={(e) => set("role", e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Use case" htmlFor="cf-use" required error={errors.useCase}>
          <Select id="cf-use" value={v.useCase} onChange={(e) => set("useCase", e.target.value)} aria-invalid={!!errors.useCase}>
            <option value="" disabled>Select…</option>
            {USE_CASES.map((u) => <option key={u}>{u}</option>)}
          </Select>
        </Field>
        <Field label="Expected monthly call volume" htmlFor="cf-vol" required error={errors.volume}>
          <Select id="cf-vol" value={v.volume} onChange={(e) => set("volume", e.target.value)} aria-invalid={!!errors.volume}>
            <option value="" disabled>Select…</option>
            {VOLUMES.map((u) => <option key={u}>{u}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="What do you want to build?" htmlFor="cf-msg" hint="Optional — a few lines helps us scope the first call.">
        <Textarea id="cf-msg" value={v.message} onChange={(e) => set("message", e.target.value)} />
      </Field>

      <Checkbox
        id="cf-consent"
        checked={v.consent}
        onChange={(e) => set("consent", e.target.checked)}
        label="I agree to be contacted about this enquiry. No marketing lists."
      />
      {errors.consent && <p className="-mt-2 text-xs text-sl-down">{errors.consent}</p>}

      <Button type="submit" size="lg" className="w-fit" loading={status === "sending"}>
        Send enquiry
      </Button>
    </form>
  );
}
