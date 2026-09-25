import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectKey, CreateKey, RowActions } from "@/components/KeyActions";
import { Badge, Empty, PageHeader, Panel, Table } from "@/components/ui";
import { apiFetch, type ConsoleSummary } from "@/lib/api";
import { date, int, usd } from "@/lib/format";
import { fingerprint, getActiveKey, getKeys } from "@/lib/keys";
import { accountsEnabled, me, type AccountKey } from "@/lib/account";
import { AccountKeyRow, CreateAccountKey, LinkAccountKey, MigrateBanner } from "@/components/AccountKeys";

export const metadata: Metadata = { title: "API keys" };

export default async function KeysPage() {
  if (accountsEnabled()) return <AccountKeysPage />;
  const [keys, active] = await Promise.all([getKeys(), getActiveKey()]);
  const rows = await Promise.all(
    keys.map(async (k) => ({ k, s: await apiFetch<ConsoleSummary>("/v1/console/summary", { key: k.k }) })),
  );

  return (
    <>
      <PageHeader
        title="API keys"
        lede="Keys connected to this console. Every figure is read live from the API with that key."
        actions={<Suspense><CreateKey /></Suspense>}
      />
      <Panel title={`Connected keys (${keys.length}/10)`}>
        {keys.length === 0 ? (
          <Empty title="No keys yet" body="Create a free key, or connect a key you already use." />
        ) : (
          <Table head={["Key", "Label", "Tier", "Plan", "Credits", "Calls this month", "Added", ""]} numeric={[4, 5]}>
            {rows.map(({ k, s }) => (
              <tr key={k.k}>
                <td className="font-mono">{fingerprint(k.k)} {k.k === active?.k && <Badge tone="good">active</Badge>}</td>
                <td>{k.label}</td>
                <td>{s.ok ? s.data.data.tier ?? "none" : <span className="text-sl-down">unavailable</span>}</td>
                <td className="capitalize">{s.ok ? s.data.data.plan : ""}</td>
                <td className="text-right">{s.ok ? usd(s.data.data.balanceUsd, 4) : ""}</td>
                <td className="text-right">{s.ok && s.data.data.usage ? int(s.data.data.usage.callsThisMonth) : ""}</td>
                <td>{date(k.addedAt)}</td>
                <td><RowActions fp={fingerprint(k.k)} active={k.k === active?.k} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Connect an existing key" className="mt-4">
        <ConnectKey />
      </Panel>

      <Panel title="How keys are held" className="mt-4">
        <ul className="list-disc space-y-1 pl-5 text-sl-text-muted">
          <li>Connected keys are stored in a Secure, httpOnly cookie on this console only — page scripts cannot read them.</li>
          <li>Disconnecting removes a key from this console. It does not revoke the key on the API; bulk revoke and rotation arrive with server-side account linking.</li>
          <li>Rate limits come from the key's tier today. Scopes, spend caps and per-key limits arrive with account linking.</li>
        </ul>
      </Panel>
    </>
  );
}

// CONSOLE_ACCOUNTS_V1: keys live on the account (server-side), identical in
// every browser. The per-browser cookie is only read to offer the migration.
async function AccountKeysPage() {
  const [res, browserKeys] = await Promise.all([me<AccountKey[]>("/keys"), getKeys()]);
  return (
    <>
      <PageHeader
        title="API keys"
        lede="Keys on your account — the same on every browser and device. A key is shown once, when it is created."
        actions={<CreateAccountKey />}
      />
      {browserKeys.length > 0 && <MigrateBanner count={browserKeys.length} />}
      <Panel title={res.ok ? `Keys (${res.data.length})` : "Keys"}>
        {!res.ok ? (
          <Empty title="Couldn't load your keys" body="The account service didn't answer. Refresh in a moment." />
        ) : res.data.length === 0 ? (
          <Empty title="No keys yet" body="Create a free key, or link a key you already use." />
        ) : (
          <Table head={["Key", "Name", "Tier", "Credits", "Daily cap", "Last used", ""]} numeric={[3, 4]}>
            {res.data.map((k) => <AccountKeyRow key={k.id} k={k} />)}
          </Table>
        )}
      </Panel>
      <Panel title="Link an existing key" className="mt-4">
        <LinkAccountKey />
      </Panel>
      <Panel title="How keys work now" className="mt-4">
        <ul className="list-disc space-y-1 pl-5 text-sl-text-muted">
          <li>Keys belong to your account. This browser stores none of them.</li>
          <li>Pause stops a key instantly; a daily cap stops it for the day once reached. Both are enforced by the API on every call.</li>
          <li>Rotate issues a new key, moves the remaining balance to it and switches the old one off. Revoke switches a key off; its balance stays on it.</li>
        </ul>
      </Panel>
    </>
  );
}
