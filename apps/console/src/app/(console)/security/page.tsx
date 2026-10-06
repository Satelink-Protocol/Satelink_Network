import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Panel, Table } from "@/components/ui";
import { requireAgentIa } from "@/lib/trading/guard";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  requireAgentIa();
  const session = await getSession();
  const twoFactor = session?.user.twoFactorEnabled === true;
  return (
    <>
      <PageHeader title="Security" lede="How your account and your trading are protected." />
      <Panel title="Protection">
        <Table head={["Protection", "Status"]}>
          <tr><td>Authenticator app (2-step sign-in)</td><td>{twoFactor ? <Badge tone="good">on</Badge> : <Badge tone="warn">off — needed to sign permissions or resume trading</Badge>}</td></tr>
          <tr><td>Code required to sign a permission, approve a suggestion or resume trading</td><td><Badge tone="good">always</Badge></td></tr>
          <tr><td>Agent can place or cancel orders</td><td><Badge tone="good">never</Badge></td></tr>
          <tr><td>Keys or passwords shown in this browser</td><td><Badge tone="good">never</Badge></td></tr>
        </Table>
      </Panel>
      <Panel title="Manage" className="mt-4">
        <ul className="grid gap-1">
          <li><Link className="text-sl-accent underline" href="/settings">Sessions and 2-step sign-in</Link></li>
          <li><Link className="text-sl-accent underline" href="/keys">API keys</Link></li>
        </ul>
      </Panel>
    </>
  );
}
