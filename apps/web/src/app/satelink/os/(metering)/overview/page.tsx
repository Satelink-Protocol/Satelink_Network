"use client";

import { useCallback, useEffect, useState } from "react";
import { useEndpoint } from "@satelink/ui";

const REFRESH_MS = 60_000;

function Updated({ at }: { at: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  if (at == null) return null;
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  return <div className="os-updated">Last updated: {secs} seconds ago</div>;
}

function Card({
  title,
  endpoint,
  children,
}: {
  title: string;
  endpoint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="os-card">
      <div className="os-card-title">{title}</div>
      <div className="os-card-endpoint">{endpoint}</div>
      {children}
    </div>
  );
}

function ErrorBox({ name }: { name: string }) {
  return <div className="os-error">Unable to load {name}</div>;
}

/* ---------- Section 1: System Health ---------- */

interface RpcHealth {
  summary: {
    healthy: number;
    unhealthy: number;
    total: number;
    healthPercent: string;
  };
  providers: {
    chain: string;
    provider: string;
    status: string;
    avgLatencyMs: number;
    successRate: string;
  }[];
}

function SystemHealth() {
  const w = useEndpoint<RpcHealth>(["/rpc/health"]);
  return (
    <Card title="System Health" endpoint="GET /rpc/health">
      {w.loading && <div className="os-loading">Loading…</div>}
      {!w.loading && w.error && !w.data && <ErrorBox name="/rpc/health" />}
      {w.data && (
        <>
          <div className="os-kv-grid">
            <div>
              <div className="os-kv-label">Providers Healthy</div>
              <div
                className={`os-kv-value ${
                  w.data.summary.unhealthy === 0 ? "green" : "amber"
                }`}
              >
                {w.data.summary.healthy}/{w.data.summary.total}
              </div>
            </div>
            <div>
              <div className="os-kv-label">Health</div>
              <div className="os-kv-value green">
                {w.data.summary.healthPercent}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16, maxHeight: 220, overflowY: "auto" }}>
            {w.data.providers.map((p) => (
              <div className="os-provider-row" key={`${p.chain}-${p.provider}`}>
                <span className="os-provider-name">
                  <span
                    className={`os-dot ${p.status === "healthy" ? "ok" : "bad"}`}
                  />
                  {p.chain} / {p.provider}
                </span>
                <span className="os-provider-name">
                  {p.avgLatencyMs}ms · {p.successRate}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <Updated at={w.updatedAt} />
    </Card>
  );
}

/* ---------- Section 2: Network Status ---------- */

interface ApiStatus {
  status: string;
  uptime_pct: number;
  nodes_online: number;
  current_epoch: number;
  total_requests_24h: number;
  avg_latency_ms: number;
}

function NetworkStatus() {
  const w = useEndpoint<ApiStatus>(["/api/status"]);
  return (
    <Card title="Network Status" endpoint="GET /api/status">
      {w.loading && <div className="os-loading">Loading…</div>}
      {!w.loading && w.error && !w.data && <ErrorBox name="/api/status" />}
      {w.data && (
        <div className="os-kv-grid">
          <div>
            <div className="os-kv-label">Epoch</div>
            <div className="os-kv-value">
              {w.data.current_epoch.toLocaleString("en-US")}
            </div>
          </div>
          <div>
            <div className="os-kv-label">Requests (24h)</div>
            <div className="os-kv-value green">
              {w.data.total_requests_24h.toLocaleString("en-US")}
            </div>
          </div>
          <div>
            <div className="os-kv-label">Avg Latency</div>
            <div className="os-kv-value">{w.data.avg_latency_ms}ms</div>
          </div>
          <div>
            <div className="os-kv-label">Nodes Online</div>
            {w.data.nodes_online === 0 ? (
              <div className="os-kv-value red">Node agent offline</div>
            ) : (
              <div className="os-kv-value green">{w.data.nodes_online}</div>
            )}
          </div>
          <div>
            <div className="os-kv-label">Uptime</div>
            <div className="os-kv-value">{w.data.uptime_pct}%</div>
          </div>
        </div>
      )}
      <Updated at={w.updatedAt} />
    </Card>
  );
}

/* ---------- Sections 3 & 5: Settlement data ---------- */

interface SettlementEpoch {
  id: number;
  status: string;
  totalRevenue: string;
  nodePool: string;
  platformFee: string;
  merkleRoot: string | null;
  txHash: string | null;
}

interface SettlementHistory {
  ok: boolean;
  epochs: SettlementEpoch[];
  count: number;
}

function Treasury() {
  const w = useEndpoint<SettlementHistory>(["/api/settlement/history"]);
  const metered =
    w.data?.epochs.reduce((sum, e) => sum + parseFloat(e.totalRevenue), 0) ?? 0;
  return (
    <Card title="Treasury (On-Chain Truth)" endpoint="GET /api/settlement/history">
      {w.loading && <div className="os-loading">Loading…</div>}
      {!w.loading && w.error && !w.data && (
        <ErrorBox name="/api/settlement/history" />
      )}
      {w.data && (
        <>
          <div className="os-kv-grid">
            <div>
              <div className="os-kv-label">Collected (on-chain)</div>
              <div className="os-kv-value">$0.00 USDT</div>
            </div>
            <div>
              <div className="os-kv-label">Metered (unbilled)</div>
              <div className="os-kv-value amber">
                ${metered.toFixed(6)} USDT
              </div>
            </div>
          </div>
          <div className="os-note">
            Metered = last {w.data.epochs.length} epochs of usage, not yet
            settled on-chain. Never counted as collected revenue.
          </div>
          <div className="os-note">Settlement anchor: running every 10 min</div>
        </>
      )}
      <Updated at={w.updatedAt} />
    </Card>
  );
}

function SettlementStatus() {
  const w = useEndpoint<SettlementHistory>(["/api/settlement/history"]);
  return (
    <Card title="Settlement Status" endpoint="GET /api/settlement/history">
      {w.loading && <div className="os-loading">Loading…</div>}
      {!w.loading && w.error && !w.data && (
        <ErrorBox name="/api/settlement/history" />
      )}
      {w.data && (
        <div className="overflow-x-auto">
          <table className="os-table">
            <thead>
              <tr>
                <th>Epoch</th>
                <th>Status</th>
                <th>Revenue</th>
                <th>Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {w.data.epochs.slice(0, 5).map((e) => (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>
                    <span
                      className={`os-pill ${
                        e.txHash
                          ? "ok"
                          : e.status === "CLOSED"
                            ? "pending"
                            : "neutral"
                      }`}
                    >
                      {e.txHash ? "settled" : "pending"}
                    </span>
                  </td>
                  <td>${parseFloat(e.totalRevenue).toFixed(6)}</td>
                  <td>
                    {e.txHash ? (
                      <a
                        href={`https://polygonscan.com/tx/${e.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--accent)" }}
                      >
                        {e.txHash.slice(0, 10)}…
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Updated at={w.updatedAt} />
    </Card>
  );
}

/* ---------- Section 4: Free Tier Monitor ---------- */

interface FreeTier {
  activeIPs: number;
  totalCalls: number;
  nearLimitIPs?: number;
  limit: number;
}

function FreeTierMonitor() {
  const w = useEndpoint<FreeTier>(["/system/free-tier", "/stats/free-tier"]);
  return (
    <Card title="Free Tier Monitor" endpoint="GET /system/free-tier">
      {w.loading && <div className="os-loading">Loading…</div>}
      {!w.loading && w.error && !w.data && <ErrorBox name="/system/free-tier" />}
      {w.data && (
        <div className="os-kv-grid">
          <div>
            <div className="os-kv-label">Active IPs</div>
            <div className="os-kv-value green">
              {w.data.activeIPs.toLocaleString("en-US")}
            </div>
          </div>
          <div>
            <div className="os-kv-label">Calls Today</div>
            <div className="os-kv-value">
              {w.data.totalCalls.toLocaleString("en-US")}
            </div>
          </div>
          <div>
            <div className="os-kv-label">Daily Limit / IP</div>
            <div className="os-kv-value">{w.data.limit}</div>
          </div>
        </div>
      )}
      <Updated at={w.updatedAt} />
    </Card>
  );
}

/* ---------- Section 6: Chainlist Status (static) ---------- */

function ChainlistStatus() {
  return (
    <Card title="Chainlist Status" endpoint="static">
      <div className="overflow-x-auto">
        <table className="os-table">
          <thead>
            <tr>
              <th>PR</th>
              <th>Repo</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <a
                  href="https://github.com/ethereum-lists/chains/pull/8314"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)" }}
                >
                  #8314
                </a>
              </td>
              <td>ethereum-lists/chains</td>
              <td>
                <span className="os-pill pending">Pending ligi review</span>
              </td>
            </tr>
            <tr>
              <td>
                <a
                  href="https://github.com/DefiLlama/chainlist/pull/2824"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)" }}
                >
                  #2824
                </a>
              </td>
              <td>chainlist.org</td>
              <td>
                <span className="os-pill bad">Closed — validation failed, needs reopen</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="os-note">Merge = ~395x traffic growth</div>
    </Card>
  );
}

/* ---------- Page ---------- */

export default function OverviewPage() {
  return (
    <div className="os-grid">
      <SystemHealth />
      <NetworkStatus />
      <Treasury />
      <FreeTierMonitor />
      <SettlementStatus />
      <ChainlistStatus />
    </div>
  );
}
