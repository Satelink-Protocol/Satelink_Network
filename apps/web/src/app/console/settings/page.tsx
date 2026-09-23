// Console → Settings (web-v3 P6). Profile, sign-in methods, 2FA, sessions,
// notifications, Download my data, Delete account, and legal links. Account
// mutations are served by Track B; controls that need it carry a Planned badge
// or a clear "rolling out" state.
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, ConsoleEmpty, PlannedBadge } from "../_components";
import { DownloadData, DeleteAccount } from "./AccountActions";

export const metadata: Metadata = { title: "Settings" };

const SIGN_IN_METHODS = ["Email & password", "Google"]; // Apple is out for now (A6)

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" lede="Your profile, sign-in methods, security, and data." />

      <div className="grid gap-6">
        <Panel title="Profile">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wide text-sl-text-subtle">Name</dt><dd className="mt-1 text-sm text-sl-text-muted">Set after sign-in</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-sl-text-subtle">Email</dt><dd className="mt-1 text-sm text-sl-text-muted">Set after sign-in</dd></div>
          </dl>
        </Panel>

        <Panel title="Sign-in methods" action={<PlannedBadge>Manage in Track B</PlannedBadge>}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {SIGN_IN_METHODS.map((m) => (
              <li key={m} className="flex items-center justify-between rounded-[var(--sl-radius)] border border-sl-border px-3 py-2 text-sm text-sl-text-muted">
                {m} <span className="text-xs text-sl-text-subtle">Link</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-sl-text-subtle">Link Google/email to one account by verified email. Two-factor authentication (TOTP) is available for extra security.</p>
        </Panel>

        <Panel title="Active sessions">
          <ConsoleEmpty title="No other sessions" body="Devices signed in to your account will be listed here so you can sign them out." />
        </Panel>

        <Panel title="Notifications" action={<PlannedBadge />}>
          <p className="text-sm text-sl-text-muted">Choose which usage alerts and receipts we email you.</p>
        </Panel>

        <Panel title="Your data">
          <p className="text-sm text-sl-text-muted">Export a copy of your personal data, or delete your account.</p>
          <div className="mt-4 flex flex-wrap items-start gap-6">
            <DownloadData />
            <DeleteAccount />
          </div>
        </Panel>

        <Panel title="Legal">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {[["Terms", "/terms"], ["Privacy", "/privacy"], ["Billing", "/billing-policy"], ["Refund", "/refund"], ["Security", "/security"]].map(([l, h]) => (
              <li key={h}><Link href={h} className="text-sl-accent hover:underline">{l}</Link></li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
