"use client";

import { useState } from "react";

const input = "h-9 w-full rounded border border-sl-border bg-sl-bg px-2.5 text-sm text-sl-text placeholder:text-sl-text-subtle focus:border-sl-accent focus:outline-none";

export function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [googleErr, setGoogleErr] = useState(false);

  const google = async () => {
    setGoogleErr(false);
    const r = await fetch("/api/identity/sign-in/social", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: `${window.location.origin}${next}` }),
    });
    const j = await r.json().catch(() => null);
    if (j?.url) window.location.href = j.url;
    else setGoogleErr(true);
  };

  if (state === "sent") {
    return (
      <div role="status" className="rounded-md border border-sl-border bg-sl-surface p-4">
        <p className="font-medium text-sl-text">Check your email</p>
        <p className="mt-1 text-sl-text-muted">We sent a sign-in link to {email}. It expires shortly.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={google} className="flex h-9 w-full items-center justify-center gap-2 rounded border border-sl-border bg-sl-surface text-sm font-medium text-sl-text hover:border-sl-border-strong">
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Continue with Google
      </button>
      {googleErr && <p role="alert" className="text-sl-down">Google sign-in isn&apos;t available right now. Use email instead.</p>}
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-sl-text-subtle"><span className="h-px flex-1 bg-sl-border" />or<span className="h-px flex-1 bg-sl-border" /></div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setState("sending");
          const r = await fetch("/api/identity/sign-in/magic-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, callbackURL: `${window.location.origin}${next}` }),
          });
          setState(r.ok ? "sent" : "error");
        }}
        className="space-y-2"
      >
        <label className="block">
          <span className="mb-1 block text-xs text-sl-text-muted">Work email</span>
          <input className={input} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        <button type="submit" disabled={state === "sending"} className="h-9 w-full rounded bg-sl-accent text-sm font-semibold text-sl-accent-ink hover:bg-sl-accent-strong disabled:opacity-60">
          {state === "sending" ? "Sending…" : "Email me a sign-in link"}
        </button>
        {state === "error" && <p role="alert" className="text-sl-down">Couldn&apos;t send the link. Try again in a minute.</p>}
      </form>
    </div>
  );
}
