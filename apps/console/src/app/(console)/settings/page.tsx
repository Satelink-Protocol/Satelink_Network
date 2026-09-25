import type { Metadata } from "next";
import { RevokeOthers, RevokeSession, SignOut } from "@/components/SessionActions";
import { Badge, PageHeader, Panel, Table } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { date } from "@/lib/format";
import { authCookieHeader, getSession } from "@/lib/session";
import { accountsEnabled } from "@/lib/account";
import { loadSettings } from "@/lib/v2";
import { Preferences } from "@/components/v2/Preferences";
import { TwoFactor } from "@/components/v2/TwoFactor";

export const metadata: Metadata = { title: "Settings" };

type Account = { providerId: string; createdAt: string };
type SessionRow = { id: string; token: string; createdAt: string; expiresAt: string; userAgent?: string | null; ipAddress?: string | null };

const PRIVACY_EMAIL = "satelinknetwork@gmail.com";

export default async function SettingsPage() {
  const session = await getSession();
  const cookie = await authCookieHeader();
  const [accounts, sessions] = await Promise.all([
    apiFetch<Account[]>("/api/identity/list-accounts", { cookie }),
    apiFetch<SessionRow[]>("/api/identity/list-sessions", { cookie }),
  ]);
  const u = session!.user;
  const accountMode = accountsEnabled();
  const prefs = accountMode ? await loadSettings() : null;
  const providers = accounts.ok ? accounts.data.map((a) => a.providerId) : null;

  return (
    <>
      <PageHeader title="Settings" actions={<SignOut />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Profile">
          <Table head={["Field", "Value"]}>
            <tr><td className="text-sl-text-muted">Name</td><td>{u.name || "Not set"}</td></tr>
            <tr><td className="text-sl-text-muted">Email</td><td>{u.email} {u.emailVerified ? <Badge tone="good">verified</Badge> : <Badge tone="warn">unverified</Badge>}</td></tr>
            {u.createdAt && <tr><td className="text-sl-text-muted">Member since</td><td>{date(u.createdAt)}</td></tr>}
          </Table>
        </Panel>
        <Panel title="Sign-in methods">
          {providers ? (
            <Table head={["Method", "Status"]}>
              <tr><td>Google</td><td>{providers.includes("google") ? <Badge tone="good">linked</Badge> : <Badge>not linked</Badge>}</td></tr>
              <tr><td>Email and password</td><td>{providers.includes("credential") ? <Badge tone="good">set</Badge> : <Badge>not set</Badge>}</td></tr>
              <tr><td>Email magic link</td><td><Badge tone="good">available</Badge></td></tr>
            </Table>
          ) : (
            <p className="text-sl-text-muted">Couldn&apos;t load sign-in methods.</p>
          )}
        </Panel>
        <Panel title="Two-factor authentication">
          <p>{u.twoFactorEnabled ? <Badge tone="good">on</Badge> : <Badge tone="warn">off</Badge>}</p>
          {accountMode ? (
            <div className="mt-2"><TwoFactor enabled={Boolean(u.twoFactorEnabled)} hasPassword={Boolean(providers?.includes("credential"))} /></div>
          ) : (
            <p className="mt-2 text-sl-text-muted">
              TOTP two-factor is supported by the account system and requires an email-and-password sign-in method. Self-serve setup in the console is not built yet.
            </p>
          )}
        </Panel>
        <Panel title="Data">
          <p className="text-sl-text-muted">Download everything this console holds or reads for you: profile, connected keys (fingerprints only), usage and deposits.</p>
          <a href={accountMode ? "/api/console/account-export" : "/api/console/export"} className="mt-2 inline-block h-7 rounded border border-sl-border px-2.5 py-1.5 text-xs hover:border-sl-accent">Export my data (JSON)</a>
        </Panel>
      </div>

      {accountMode && (
        <Panel title="Preferences, spending and alerts" className="mt-4">
          {prefs?.ok ? <Preferences initial={prefs.data} /> : <p className="text-sl-text-muted">Couldn&apos;t load your settings.</p>}
        </Panel>
      )}

      <Panel title="Active sessions" className="mt-4" action={<RevokeOthers />}>
        {sessions.ok ? (
          <Table head={["Device", "IP", "Signed in", "Expires", ""]}>
            {sessions.data.map((s) => (
              <tr key={s.id}>
                <td className="max-w-[22rem] truncate text-sl-text-muted" title={s.userAgent || ""}>{s.userAgent || "Unknown device"}</td>
                <td className="font-mono">{s.ipAddress || ""}</td>
                <td>{date(s.createdAt)}</td>
                <td>{date(s.expiresAt)}</td>
                <td className="text-right"><RevokeSession token={s.token} current={s.id === session!.session.id} /></td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sl-text-muted">Couldn&apos;t load sessions.</p>
        )}
      </Panel>

      <Panel title="Delete account" className="mt-4">
        <p className="text-sl-text-muted">
          You can ask us to erase your account and personal data under the Digital Personal Data Protection Act, 2023. We give at
          least 48 hours&apos; notice before erasure so you can export your data or change your mind. Balances held on the crypto rail
          and records we must keep by law are handled as described in the privacy policy.
        </p>
        <a
          href={`mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent("Account deletion request")}&body=${encodeURIComponent(`Please delete the Satelink account for ${u.email}.`)}`}
          className="mt-2 inline-block h-7 rounded border border-sl-down/50 px-2.5 py-1.5 text-xs text-sl-down"
        >
          Request account deletion
        </a>
        <p className="mt-2 text-[11px] text-sl-text-subtle">
          Legal: <a className="underline" href="https://satelink.network/privacy">Privacy</a> · <a className="underline" href="https://satelink.network/terms">Terms</a>
        </p>
      </Panel>
    </>
  );
}
