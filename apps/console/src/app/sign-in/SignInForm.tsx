"use client";

import { useState } from "react";

const input = "h-11 w-full rounded-[var(--sl-radius)] border border-sl-border-strong bg-sl-surface px-3.5 text-[15px] text-sl-text placeholder:text-sl-text-subtle focus:border-sl-accent focus:outline-none focus:ring-2 focus:ring-sl-accent/30";

export function SignInForm({ next, signup = false }: { next: string; signup?: boolean }) {
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
      <div role="status" className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6 text-center">
        <p className="font-sl-display text-xl text-sl-text">Check your email</p>
        <p className="mt-2 text-sl-text-muted">We sent a sign-in link to <span className="text-sl-text">{email}</span>. It expires shortly.</p>
        <button type="button" className="mt-4 text-[13px] text-sl-text-muted underline underline-offset-2 hover:text-sl-text" onClick={() => setState("idle")}>Use a different email</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button type="button" onClick={google} className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[var(--sl-radius)] border border-sl-border-strong bg-sl-surface text-[15px] font-medium text-sl-text transition-colors hover:bg-sl-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45">
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Continue with Google
      </button>
      {googleErr && <p role="alert" className="text-sl-down">Google sign-in isn&apos;t available right now. Use email instead.</p>}
      <div className="flex items-center gap-3 text-[12px] text-sl-text-subtle"><span className="h-px flex-1 bg-sl-border" />OR<span className="h-px flex-1 bg-sl-border" /></div>
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
        className="space-y-3"
      >
        <label className="block">
          <span className="sr-only">Email</span>
          <input className={input} aria-describedby="magic-hint" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" />
        </label>
        <button type="submit" disabled={state === "sending"} className="h-11 w-full rounded-[var(--sl-radius)] bg-sl-accent text-[15px] font-medium text-sl-accent-ink transition-colors hover:bg-sl-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45 disabled:opacity-60">
          {state === "sending" ? "Sending link…" : "Continue with email"}
        </button>
        <p id="magic-hint" className="text-center text-[12px] text-sl-text-subtle">We&apos;ll email you a sign-in link — no password.</p>
        {state === "error" && <p role="alert" className="text-sl-down">Couldn&apos;t send the link. Try again in a minute.</p>}
      </form>
    </div>
  );
}
