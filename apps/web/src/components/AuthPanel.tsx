"use client";
// AuthPanel (web-v3 P5) — the shared, Signal-styled auth surface for /login
// (sign in) and /signup (sign up). Provider buttons (Google/Apple), a divider,
// an email form, a magic-link option, and — on signup — a DPDP-style consent
// notice with itemized purposes and links to Terms/Privacy.
//
// The Better Auth backend (email verification, Google, Apple, magic link) is
// Track B (feat/api-auth-and-plans). Until NEXT_PUBLIC_AUTH_ENABLED is true,
// social/magic-link/new-account signup shows a clear "rolling out" state and a
// notify link — never a control that can't complete. Sign-in with an existing
// account keeps working via the current /auth/login endpoint, so the operator/
// builder/distributor consoles are unaffected.
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Field, Input, Checkbox } from "@/components/ui";

export function authEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
}

type Status =
  | { k: "idle" }
  | { k: "loading" }
  | { k: "error"; msg: string }
  | { k: "verify-email" }
  | { k: "magic-link" }
  | { k: "account-exists" }
  | { k: "rate-limited" }
  | { k: "rolling-out"; what: string };

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden focusable="false">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.3 14.6 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6S6.9 20.8 12 20.8c5.3 0 8.8-3.7 8.8-9 0-.6-.06-1-.15-1.5H12z" />
    </svg>
  );
}
function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden focusable="false" fill="currentColor">
      <path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.15-2.8.85-3.5.85s-1.8-.83-3-.8c-1.5.02-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.6 2.3 2.8 2.25 1.1-.05 1.6-.72 2.9-.72s1.8.72 3 .7c1.2-.02 2-1.1 2.7-2.2.85-1.25 1.2-2.46 1.2-2.5-.03-.02-2.3-.9-2.3-3.5zM14.2 5.4c.6-.75 1-1.8.9-2.9-.9.04-2 .6-2.6 1.36-.55.65-1 1.7-.9 2.7 1 .08 2-.5 2.6-1.16z" />
    </svg>
  );
}

export function AuthPanel({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const enabled = authEnabled();
  const isSignup = mode === "signup";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [magic, setMagic] = React.useState(false);
  const [status, setStatus] = React.useState<Status>({ k: "idle" });

  const notifyHref = "/contact-sales?topic=account";

  async function onProvider(provider: "google" | "apple") {
    if (!enabled) {
      setStatus({ k: "rolling-out", what: provider === "google" ? "Google sign-in" : "Apple sign-in" });
      return;
    }
    // Better Auth social sign-in (Track B).
    window.location.href = `/api/auth/sign-in/social?provider=${provider}`;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ k: "loading" });

    // Sign in with an existing account: keep the current, working endpoint so
    // the operator/builder/distributor consoles are unaffected.
    if (!isSignup && !magic) {
      try {
        const res = await fetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) return setStatus({ k: "rate-limited" });
        if (!res.ok || !data.ok || !data.token) {
          return setStatus({ k: "error", msg: data.error || "Invalid email or password." });
        }
        let role: string | null = null;
        try {
          role = JSON.parse(atob(data.token.split(".")[1]))?.role ?? null;
        } catch {}
        try {
          localStorage.setItem("satelink_token", data.token);
          localStorage.setItem("satelink_role", role ?? data.user?.role ?? "");
        } catch {}
        const next = params.get("next");
        router.replace(next && next.startsWith("/") ? next : "/console");
      } catch {
        setStatus({ k: "error", msg: "Could not reach the server. Try again." });
      }
      return;
    }

    // Magic link / new-account signup require the Better Auth backend (Track B).
    if (!enabled) {
      setStatus({ k: "rolling-out", what: magic ? "Magic-link sign-in" : "Email sign-up" });
      return;
    }
    setStatus({ k: magic ? "magic-link" : "verify-email" });
  }

  return (
    <div className="w-full max-w-md rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6 shadow-[var(--sl-shadow-2)] sm:p-8">
      <h1 className="font-sl-display text-2xl font-extrabold tracking-tight text-sl-text">
        {isSignup ? "Create your account" : "Sign in"}
      </h1>
      <p className="mt-1 text-sm text-sl-text-muted">
        {isSignup ? "Start free — 300 Trading-Intelligence calls a month." : "Welcome back to Satelink."}
      </p>

      {/* Provider buttons */}
      <div className="mt-6 grid gap-2">
        <Button variant="secondary" className="w-full justify-center" onClick={() => onProvider("google")} type="button">
          <GoogleMark /> Continue with Google
        </Button>
        <Button variant="secondary" className="w-full justify-center" onClick={() => onProvider("apple")} type="button">
          <AppleMark /> Continue with Apple
        </Button>
      </div>

      <div className="my-5 flex items-center gap-3 text-xs text-sl-text-subtle">
        <span className="h-px flex-1 bg-sl-border" /> or <span className="h-px flex-1 bg-sl-border" />
      </div>

      {/* Email form */}
      <form className="grid gap-4" onSubmit={onSubmit}>
        <Field label="Email" htmlFor="auth-email" required>
          <Input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </Field>
        {!magic && (
          <Field label="Password" htmlFor="auth-password" required>
            <Input id="auth-password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} required minLength={isSignup ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isSignup ? "At least 10 characters" : "Your password"} />
          </Field>
        )}

        {isSignup && (
          <div className="rounded-[var(--sl-radius)] border border-sl-border bg-sl-bg-raised p-3">
            <Checkbox id="auth-consent" checked={consent} onChange={(e) => setConsent(e.currentTarget.checked)}
              label={
                <span className="text-xs leading-relaxed text-sl-text-muted">
                  I agree to the <Link href="/terms" className="text-sl-accent underline">Terms</Link> and{" "}
                  <Link href="/privacy" className="text-sl-accent underline">Privacy Policy</Link>. I consent to Satelink
                  processing my account, usage, and payment metadata to provide, meter, and secure the service, and to
                  send transactional email (verification, receipts). You can withdraw consent and delete your account
                  from settings.
                </span>
              }
            />
          </div>
        )}

        <StatusNote status={status} notifyHref={notifyHref} />

        <Button type="submit" size="md" className="w-full" loading={status.k === "loading"} disabled={isSignup && !consent}>
          {isSignup ? (magic ? "Send magic link" : "Create account") : magic ? "Send magic link" : "Sign in"}
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-sl-text-muted">
        <button type="button" onClick={() => { setMagic((m) => !m); setStatus({ k: "idle" }); }} className="font-semibold text-sl-accent hover:underline">
          {magic ? "Use a password instead" : "Email me a magic link"}
        </button>
        {isSignup ? (
          <span>Have an account? <Link href="/login" className="font-semibold text-sl-accent hover:underline">Sign in</Link></span>
        ) : (
          <span>New here? <Link href="/signup" className="font-semibold text-sl-accent hover:underline">Create an account</Link></span>
        )}
      </div>

      <p className="mt-6 border-t border-sl-border pt-4 text-center text-xs text-sl-text-subtle">
        Operators &amp; staff: <Link href="/ops/login" className="text-sl-accent hover:underline">sign in at /ops/login</Link>
      </p>
    </div>
  );
}

function StatusNote({ status, notifyHref }: { status: Status; notifyHref: string }) {
  if (status.k === "idle" || status.k === "loading") return null;
  const base = "rounded-[var(--sl-radius)] border p-3 text-sm";
  if (status.k === "error")
    return <p className={`${base} border-sl-down/40 bg-sl-down/10 text-sl-text`}>{status.msg}</p>;
  if (status.k === "rate-limited")
    return <p className={`${base} border-sl-warn/40 bg-sl-warn/10 text-sl-text-muted`}>Too many attempts. Please wait a minute and try again.</p>;
  if (status.k === "account-exists")
    return <p className={`${base} border-sl-border bg-sl-bg-raised text-sl-text-muted`}>An account already exists for that email — try signing in.</p>;
  if (status.k === "verify-email")
    return <p className={`${base} border-sl-accent/40 bg-sl-accent-soft text-sl-text-muted`}>Check your inbox to verify your email and finish creating your account.</p>;
  if (status.k === "magic-link")
    return <p className={`${base} border-sl-accent/40 bg-sl-accent-soft text-sl-text-muted`}>We sent you a magic link. Open it on this device to sign in.</p>;
  // rolling-out
  return (
    <p className={`${base} border-sl-border bg-sl-bg-raised text-sl-text-muted`}>
      {status.what} is rolling out. In the meantime you can{" "}
      <Link href={notifyHref} className="font-semibold text-sl-accent underline">get notified</Link> or use{" "}
      <Link href="/products/x402" className="font-semibold text-sl-accent underline">keyless x402</Link>.
    </p>
  );
}
