import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docs | Satelink",
  description: "Satelink documentation, API reference, and node operator guides.",
};

const LINKS = [
  {
    title: "Documentation Wiki",
    desc: "Full project documentation: getting started, architecture, settlement.",
    href: "https://github.com/Satelink-Protocol/Satelink_Network/wiki",
  },
  {
    title: "API Reference",
    desc: "RPC gateway endpoints, authentication, billing headers.",
    href: "https://github.com/Satelink-Protocol/Satelink_Network/wiki/#api-reference",
  },
  {
    title: "Node Operators Guide",
    desc: "Run a node, register it, and earn 50% of routed revenue in USDT.",
    href: "https://github.com/Satelink-Protocol/Satelink_Network/wiki/#node-operators",
  },
  {
    title: "GitHub Repository",
    desc: "Full open-source codebase: gateway, contracts, frontend.",
    href: "https://github.com/Satelink-Protocol/Satelink_Network",
  },
];

export default function DocsPage() {
  return (
    <div className="os-page">
      <div className="os-shell" style={{ maxWidth: 800 }}>
        <div className="os-header">
          <div className="os-title">
            <div className="logo-icon">S</div>
            Satelink Docs
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <a href="/" className="btn btn-ghost">
              Landing
            </a>
            <a href="/satelink/os/overview" className="btn btn-secondary">
              Console
            </a>
          </div>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          {LINKS.map((l) => (
            <a
              key={l.href + l.title}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="os-card"
              style={{ display: "block" }}
            >
              <div className="proof-title">{l.title}</div>
              <p className="proof-desc" style={{ marginBottom: 0 }}>
                {l.desc}
              </p>
            </a>
          ))}

          <div className="os-card">
            <div className="os-card-title">Quick Start</div>
            <div
              className="os-card-endpoint"
              style={{ marginBottom: 0, fontSize: 13, lineHeight: 1.8 }}
            >
              # Free tier — no key required (200 req/day)
              <br />
              curl -X POST https://rpc.satelink.network/rpc/polygon \
              <br />
              &nbsp;&nbsp;-H &quot;Content-Type: application/json&quot; \
              <br />
              &nbsp;&nbsp;-d &apos;{"{"}&quot;jsonrpc&quot;:&quot;2.0&quot;,&quot;method&quot;:&quot;eth_blockNumber&quot;,&quot;params&quot;:[],&quot;id&quot;:1{"}"}&apos;
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
