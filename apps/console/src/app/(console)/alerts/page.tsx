import type { Metadata } from "next";
import { Empty, PageHeader, Panel, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
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
