import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, PageHeader, Panel, Table } from "@/components/ui";
import { accountsEnabled } from "@/lib/account";
import { loadAlerts } from "@/lib/v2";
import type { AlertEvent, AlertRule } from "@/lib/v2-shared";
import { AlertsEditor } from "@/components/v2/AlertsEditor";
import { usd } from "@/lib/format";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  if (accountsEnabled()) return <AlertsV2 />;
  return (
    <>
      <PageHeader title="Alerts" lede="Usage thresholds, spend caps and error-rate alerts by email." />
      <Panel title="Planned thresholds">
        <Table head={["Trigger", "Levels", "Delivery"]}>
          <tr><td>Plan or credit usage</td><td className="tnum">70% · 85% · 95% · 100%</td><td>Email</td></tr>
          <tr><td>Monthly spend cap</td><td>Your cap</td><td>Email</td></tr>
          <tr><td>Error rate</td><td>Your threshold</td><td>Email</td></tr>
        </Table>
      </Panel>
      <Panel title="Your alerts" className="mt-4">
        <Empty
          title="Alerts aren't available yet"
          body="Alerts need thresholds stored against your account on the API, and a sender for them. Nothing is being monitored for you yet, so no alert will be sent."
        />
      </Panel>
    </>
  );
}

const RULE_LABEL: Record<AlertRule["kind"], string> = {
  usage: "Usage",
  spend_cap: "Monthly spend cap",
  low_balance: "Low balance",
  deposit_confirmed: "Deposit confirmed",
  error_rate: "Error rate",
};
const EVENT_LABEL: Record<AlertEvent["kind"], string> = { ...RULE_LABEL, test: "Test" };

function ruleSetting(r: AlertRule) {
  if (r.kind === "usage") return r.levels?.length ? `${r.levels.join("% · ")}% of a key's daily limit or your plan allowance` : "No levels chosen";
  if (r.kind === "spend_cap") return r.capUsdt ? `${r.levels?.join("% · ")}% of ${usd(r.capUsdt)}` : "No monthly cap set";
  if (r.kind === "low_balance") return r.floorUsdt === null || r.floorUsdt === undefined ? "Off" : `Below ${usd(r.floorUsdt, 4)} per key`;
  if (r.kind === "deposit_confirmed") return "Every confirmed deposit";
  return r.thresholdPct ? `Above ${r.thresholdPct}% — saved, not measured yet` : "Not measured yet";
}

function RuleStatus({ status }: { status: AlertRule["status"] }) {
  if (status === "on") return <Badge tone="good">on</Badge>;
  if (status === "not_measured") return <Badge tone="warn">not measured</Badge>;
  return <Badge>off</Badge>;
}

const DELIVERY: Record<AlertEvent["delivery"], { label: string; tone: "good" | "warn" | "neutral" }> = {
  sent: { label: "sent", tone: "good" },
  queued: { label: "sending", tone: "neutral" },
  failed: { label: "failed", tone: "warn" },
  suppressed: { label: "covered by a higher level", tone: "neutral" },
  skipped_no_sender: { label: "not sent — email not configured", tone: "warn" },
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

async function AlertsV2() {
  const r = await loadAlerts();
  return (
    <>
      <PageHeader title="Alerts" lede="Emails about usage, spend, low balance and deposits for your account. Checked by the API every few minutes." />
      {!r.ok ? (
        <Empty title="Couldn't load your alerts" body="Refresh in a moment. Your settings are safe." />
      ) : (
        <>
          <Panel title="What we watch">
            <Table head={["Alert", "Setting", "Status"]} label="Alert rules">
              {r.data.rules.map((rule) => (
                <tr key={rule.kind}>
                  <td className="text-sl-text">{RULE_LABEL[rule.kind]}</td>
                  <td>{ruleSetting(rule)}</td>
                  <td><RuleStatus status={rule.status} /></td>
                </tr>
              ))}
            </Table>
            <p className="px-4 pb-4 text-[12px] text-sl-text-muted">
              Usage levels, the monthly cap and which emails you get are in <Link href="/settings" className="text-sl-accent underline">Settings</Link>.
              {" "}Alerts go to your account email from {r.data.sender.from}.
              {!r.data.evaluator.enabled && " Alert checks are paused on the server right now."}
            </p>
          </Panel>
          <Panel title="Alert settings" className="mt-4">
            <div className="p-4"><AlertsEditor initial={r.data.prefs} senderConfigured={r.data.sender.configured} /></div>
          </Panel>
          <Panel title="Alert history" className="mt-4">
            {r.data.history.length === 0 ? (
              <div className="p-4"><Empty title="No alerts sent yet" body="When a level is crossed, a deposit lands, or you send a test, it appears here." /></div>
            ) : (
              <Table head={["When", "Alert", "Message", "Delivery"]} label="Alert history">
                {r.data.history.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-sl-text-muted">{when(e.createdAt)}</td>
                    <td>{EVENT_LABEL[e.kind]}</td>
                    <td className="text-sl-text">{e.subject.replace(/^Satelink: /, "")}</td>
                    <td><Badge tone={DELIVERY[e.delivery].tone}>{DELIVERY[e.delivery].label}</Badge>{e.error && <span className="ml-2 text-[12px] text-sl-text-subtle">{e.error}</span>}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
