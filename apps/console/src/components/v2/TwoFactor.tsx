"use client";
// Self-serve TOTP via Better Auth's twoFactor plugin (/api/identity/two-factor/*).
// Better Auth requires the account password to turn it on or off.
import { useState } from "react";
import { useRouter } from "next/navigation";

const call = async (path: string, body: unknown) => {
  const r = await fetch(`/api/identity/two-factor/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, j: await r.json().catch(() => null) };
};
const input = "h-9 w-full rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-2 text-[13px] text-sl-text";

export function TwoFactor({ enabled, hasPassword }: { enabled: boolean; hasPassword: boolean }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [setup, setSetup] = useState<{ uri: string; codes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  if (!hasPassword) return <p className="text-[13px] text-sl-text-muted">Two-factor needs a password sign-in method on the account (a Better Auth requirement). Sign in with email and set a password to turn it on.</p>;
  if (setup) {
    const secret = new URL(setup.uri).searchParams.get("secret");
    return (
      <div className="space-y-2 text-[13px]">
        <p className="text-sl-text">Add Satelink to your authenticator app with this key, then enter the 6-digit code.</p>
        <p className="break-all rounded border border-sl-border bg-sl-bg p-2 font-mono text-sl-text" tabIndex={0}>{secret}</p>
        <a className="text-sl-accent underline" href={setup.uri}>Open in authenticator app</a>
        <details><summary className="cursor-pointer text-sl-text-muted">Backup codes (save them now)</summary><p className="mt-1 font-mono text-sl-text">{setup.codes.join("  ")}</p></details>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const r = await call("verify-totp", { code }); if (r.ok) { setSetup(null); router.refresh(); } else setMsg("That code didn't match. Try the newest one."); }}>
          <label className="sr-only" htmlFor="totp">Code</label>
          <input id="totp" className={input} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          <button className="h-9 rounded bg-sl-accent px-3 text-sl-accent-ink" type="submit">Verify</button>
        </form>
        {msg && <p role="alert" className="text-sl-down">{msg}</p>}
      </div>
    );
  }
  return (
    <form className="space-y-2 text-[13px]" onSubmit={async (e) => {
      e.preventDefault();
      setMsg(null);
      const r = await call(enabled ? "disable" : "enable", { password: pw });
      if (!r.ok) { setMsg("That password didn't work."); return; }
      if (enabled) router.refresh(); else setSetup({ uri: r.j?.totpURI, codes: r.j?.backupCodes ?? [] });
      setPw("");
    }}>
      <label className="block"><span className="mb-1 block text-sl-text-muted">Account password</span><input className={input} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
      <button type="submit" className={`h-9 rounded px-3 ${enabled ? "border border-sl-down/50 text-sl-down" : "bg-sl-accent text-sl-accent-ink"}`}>{enabled ? "Turn off two-factor" : "Turn on two-factor"}</button>
      {msg && <p role="alert" className="text-sl-down">{msg}</p>}
    </form>
  );
}
