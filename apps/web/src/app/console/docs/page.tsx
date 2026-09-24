// Console → Docs & SDKs (web-v3 P6). A quickstart with the user's real key
// masked. Until Track B issues keys, a masked placeholder is shown with a link
// to create one.
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "../_components";
import { CodeBlock } from "@/components/ui/CodeBlock";

export const metadata: Metadata = { title: "Docs & SDKs" };

const MASKED_KEY = "sk_live_••••••••••••••••";

export default function DocsPage() {
  return (
    <>
      <PageHeader title="Docs & SDKs" lede="Everything you need to make your first call." />

      <Panel title="Your API key">
        <p className="text-sm text-sl-text-muted">
          Your key is shown in full only once, when you create it. After that it's masked:
        </p>
        <p className="mt-2 font-sl-mono text-sm text-sl-text">{MASKED_KEY}</p>
        <Link href="/console/agents" className="mt-3 inline-block text-sm font-semibold text-sl-accent hover:underline">
          Create or rotate a key →
        </Link>
      </Panel>

      <div className="mt-6">
        <Panel title="Quickstart — your first call">
          <CodeBlock
            ariaLabel="Quickstart"
            tabs={[
              { label: "curl", code: `curl https://rpc.satelink.network/v1/intelligence/funding-rate-heatmap \\\n  -H "Authorization: Bearer ${MASKED_KEY}"` },
              { label: "TypeScript", code: `const res = await fetch(\n  "https://rpc.satelink.network/v1/intelligence/funding-rate-heatmap",\n  { headers: { Authorization: "Bearer ${MASKED_KEY}" } }\n);\nconst data = await res.json();` },
              { label: "Python", code: `import requests\nr = requests.get(\n  "https://rpc.satelink.network/v1/intelligence/funding-rate-heatmap",\n  headers={"Authorization": "Bearer ${MASKED_KEY}"},\n)\nprint(r.json())` },
            ]}
          />
          <p className="mt-4 text-sm text-sl-text-muted">
            Prefer keyless? Pay per call with x402 — see{" "}
            <Link href="/products/x402" className="text-sl-accent underline">Machine Payments</Link>. Full reference at{" "}
            <a href="https://docs.satelink.network" className="text-sl-accent underline">docs.satelink.network</a>.
          </p>
        </Panel>
      </div>
    </>
  );
}
