"use client";

import { useEffect, useState } from "react";

interface NodeRow {
  nodeId: string;
  nodeType: string;
  region: string;
  status: string;
  tier: string;
  registeredAt: string;
}

interface NodesResponse {
  ok: boolean;
  nodes: NodeRow[];
}

// /api/nodes has no last_seen field — registeredAt is the closest
// liveness signal the registry exposes.
function formatRegistered(ts: string): string {
  const n = parseInt(ts, 10);
  if (Number.isNaN(n)) return ts;
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default function NodesPage() {
  const [data, setData] = useState<NodesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/nodes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "request failed");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="os-page">
      <div className="os-shell" style={{ maxWidth: 900 }}>
        <div className="os-header">
          <div className="os-title">
            <div className="logo-icon">S</div>
            Network Nodes
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <a href="/satelink/os/overview" className="btn btn-secondary">
              Overview
            </a>
            <a href="/docs" className="btn btn-primary">
              Run a Node
            </a>
          </div>
        </div>

        <div className="os-card">
          <div className="os-card-title">Registered Nodes</div>
          <div className="os-card-endpoint">GET /api/nodes</div>

          {loading && <div className="os-loading">Loading…</div>}
          {!loading && error && <div className="os-error">Unable to load /api/nodes</div>}
          {!loading && !error && data && data.nodes.length === 0 && (
            <div className="os-note">No nodes registered yet.</div>
          )}
          {!loading && !error && data && data.nodes.length > 0 && (
            <table className="os-table">
              <thead>
                <tr>
                  <th>Node ID</th>
                  <th>Status</th>
                  <th>Region</th>
                  <th>Tier</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {data.nodes.map((n) => (
                  <tr key={n.nodeId}>
                    <td>{n.nodeId}</td>
                    <td>
                      <span
                        className={`os-pill ${n.status === "active" ? "ok" : "neutral"}`}
                      >
                        {n.status}
                      </span>
                    </td>
                    <td>{n.region}</td>
                    <td>{n.tier}</td>
                    <td>{formatRegistered(n.registeredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
