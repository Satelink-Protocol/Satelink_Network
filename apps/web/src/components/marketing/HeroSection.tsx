"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { GlobeBackground } from "@/components/effects/GlobeBackground";

interface ChainStatus {
  name: string;
  isLive: boolean;
  latency: number | null;
}

interface LiveStats {
  callsToday: number;
  usdtDistributed: number;
  nodesActive: number;
  chainsSupported: number;
}

interface TerminalLine {
  type: "command" | "response";
  text: string;
}

function AnimatedCounter({ value, decimals = 0, prefix = "" }: { value: number; decimals?: number; prefix?: string }) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    const duration = 1200;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * easeOut;
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        prevValue.current = end;
      }
    };

    requestAnimationFrame(animate);
  }, [value]);

  return <>{prefix}{decimals > 0 ? displayValue.toFixed(decimals) : Math.round(displayValue)}</>;
}

export function HeroSection() {
  const [chains, setChains] = useState<ChainStatus[]>([
    { name: "Polygon", isLive: true, latency: null },
    { name: "Ethereum", isLive: true, latency: null },
    { name: "Arbitrum", isLive: true, latency: null },
    { name: "Base", isLive: true, latency: null },
    { name: "Solana", isLive: true, latency: null },
    { name: "Amoy", isLive: true, latency: null },
  ]);

  const [stats, setStats] = useState<LiveStats>({
    callsToday: 0,
    usdtDistributed: 0,
    nodesActive: 0,
    chainsSupported: 6,
  });

  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { type: "command", text: "$ curl -X POST https://rpc.satelink.network/rpc/polygon \\" },
    { type: "command", text: '    -d \'{"method":"eth_blockNumber","id":1}\'' },
    { type: "response", text: '{"result":"0x...","id":1}' },
  ]);

  const fetchData = useCallback(async () => {
    try {
      const [healthRes, metricsRes, nodesRes] = await Promise.all([
        fetch("https://rpc.satelink.network/rpc/health"),
        fetch("https://rpc.satelink.network/rpc/metrics"),
        fetch("https://rpc.satelink.network/api/nodes").catch(() => null),
      ]);

      if (healthRes.ok) {
        const data = await healthRes.json();
        if (data.chains) {
          const chainMap: Record<string, string> = {
            polygon: "Polygon",
            ethereum: "Ethereum",
            arbitrum: "Arbitrum",
            base: "Base",
            solana: "Solana",
            amoy: "Amoy",
          };

          const updatedChains = Object.entries(data.chains).map(([key, value]: [string, unknown]) => {
            const chainData = value as { status?: string; avgLatency?: number; currentBlock?: number };
            return {
              name: chainMap[key] || key,
              isLive: chainData.status === "healthy",
              latency: chainData.avgLatency || null,
            };
          });
          setChains(updatedChains);

          const polygonBlock = (data.chains.polygon as { currentBlock?: number })?.currentBlock;
          if (polygonBlock) {
            setTerminalLines([
              { type: "command", text: "$ curl -X POST https://rpc.satelink.network/rpc/polygon \\" },
              { type: "command", text: '    -d \'{"method":"eth_blockNumber","id":1}\'' },
              { type: "response", text: `{"result":"0x${polygonBlock.toString(16)}","id":1}` },
            ]);
          }
        }
      }

      if (metricsRes.ok) {
        const data = await metricsRes.json();
        setStats((prev) => ({
          ...prev,
          callsToday: data.revenue?.eventsToday || 0,
          usdtDistributed: parseFloat(data.revenue?.usdtToday || "0"),
        }));
      }

      if (nodesRes && nodesRes.ok) {
        const data = await nodesRes.json();
        const activeNodes = (data.nodes || []).filter((n: { status: string }) => n.status === "active").length;
        setStats((prev) => ({ ...prev, nodesActive: activeNodes || 5 }));
      }
    } catch {
      // Use defaults
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#091413]">
      <GlobeBackground />
      <div className="hero-grid absolute inset-0 pointer-events-none" />

      <div className="hero-content relative z-10">
        <div className="hero-badge animate-fade-up">
          <span className="live-dot" />
          Public Beta &middot; Polygon Mainnet &middot; USDT Settlement
        </div>

        <h1 className="heading-display hero-title animate-fade-up delay-100">
          The Infrastructure Layer for
          <br />
          <span className="gradient-text">Autonomous Machine Economies</span>
        </h1>

        <p className="hero-subtitle animate-fade-up delay-200">
          Machine-to-machine RPC. Per-call USDT settlement.
          <br />
          Node operators earn 50% of every transaction.
          <br />
          <span className="emphasis">Fully autonomous. No humans required.</span>
        </p>

        <div className="hero-ctas animate-fade-up delay-300">
          <Link href="/developers" className="btn btn-primary btn-lg">
            Start for free →
          </Link>
          <Link href="/dashboard" className="btn btn-secondary btn-lg">
            View live network
          </Link>
        </div>

        <div className="live-stats animate-fade-up delay-400">
          <div className="live-stat">
            <span className="stat-icon">⟳</span>
            <span className="stat-number"><AnimatedCounter value={stats.callsToday} /></span>
            <span className="stat-label">Calls Today</span>
          </div>
          <div className="live-stat">
            <span className="stat-icon">$</span>
            <span className="stat-number"><AnimatedCounter value={stats.usdtDistributed} decimals={4} /></span>
            <span className="stat-label">USDT Distributed</span>
          </div>
          <div className="live-stat">
            <span className="stat-icon">◉</span>
            <span className="stat-number"><AnimatedCounter value={stats.nodesActive} /></span>
            <span className="stat-label">Nodes Active</span>
          </div>
          <div className="live-stat">
            <span className="stat-icon">⬡</span>
            <span className="stat-number">{stats.chainsSupported}</span>
            <span className="stat-label">Chains</span>
          </div>
        </div>

        <div className="chain-status animate-fade-up delay-500">
          {chains.slice(0, 6).map((chain) => (
            <div key={chain.name} className="chain-pill">
              <span className={`chain-dot ${!chain.isLive ? "offline" : ""}`} />
              <span>{chain.name}</span>
              {chain.latency && <span className="chain-latency">{chain.latency}ms</span>}
            </div>
          ))}
        </div>

        <div className="hero-terminal animate-fade-up delay-600">
          <div className="terminal-header">
            <div className="terminal-dots">
              <span className="terminal-dot red" />
              <span className="terminal-dot yellow" />
              <span className="terminal-dot green" />
            </div>
            <span className="terminal-title">satelink-rpc</span>
          </div>
          <div className="terminal-body">
            {terminalLines.map((line, i) => (
              <div key={i} className={`terminal-line ${line.type}`}>
                {line.text}
              </div>
            ))}
            <span className="terminal-cursor">█</span>
          </div>
          <div className="scan-line" />
        </div>
      </div>

      <style jsx>{`
        .hero-grid {
          background-image:
            linear-gradient(rgba(40, 90, 72, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(40, 90, 72, 0.06) 1px, transparent 1px);
          background-size: 50px 50px;
        }

        .gradient-text {
          background: linear-gradient(135deg, #00D1FF 0%, #B0E4CC 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-shadow: 0 0 40px rgba(0, 209, 255, 0.3);
        }

        .hero-badge {
          background: rgba(0, 209, 255, 0.1);
          border: 1px solid rgba(0, 209, 255, 0.25);
          color: #00D1FF;
        }

        .live-dot {
          width: 8px;
          height: 8px;
          background: #408A71;
          border-radius: 50%;
          animation: signal-pulse 2s ease-in-out infinite;
        }

        .hero-subtitle {
          color: #408A71;
        }

        .emphasis {
          color: #B0E4CC;
          font-weight: 500;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          border-radius: 8px;
          padding: 12px 24px;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #408A71;
          color: #091413;
          border: none;
        }

        .btn-primary:hover {
          background: #285A48;
          box-shadow: 0 0 20px rgba(0, 209, 255, 0.3);
        }

        .btn-secondary {
          background: transparent;
          color: #B0E4CC;
          border: 1px solid #408A71;
        }

        .btn-secondary:hover {
          border-color: #00D1FF;
          color: #00D1FF;
        }

        .live-stats {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: var(--space-8);
          margin-top: var(--space-10);
          padding: var(--space-6) var(--space-8);
          background: rgba(64, 138, 113, 0.08);
          border: 1px solid rgba(40, 90, 72, 0.4);
          border-radius: var(--radius-xl);
        }

        .live-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-1);
        }

        .stat-icon {
          font-size: 1.25rem;
          color: #00D1FF;
        }

        .stat-number {
          font-family: var(--font-mono);
          font-size: 1.75rem;
          font-weight: 700;
          color: #B0E4CC;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #408A71;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .chain-status {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: var(--space-2);
          margin-top: var(--space-6);
        }

        .chain-pill {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: rgba(64, 138, 113, 0.1);
          border: 1px solid rgba(40, 90, 72, 0.4);
          border-radius: var(--radius-full);
          font-size: 0.8125rem;
          color: #B0E4CC;
        }

        .chain-dot {
          width: 6px;
          height: 6px;
          background: #408A71;
          border-radius: 50%;
          animation: signal-pulse 2s ease-in-out infinite;
        }

        .chain-dot.offline {
          background: #285A48;
          animation: none;
        }

        .chain-latency {
          font-family: var(--font-mono);
          font-size: 0.6875rem;
          color: #408A71;
        }

        .hero-terminal {
          max-width: 640px;
          margin: var(--space-10) auto 0;
          background: #0d1f1d;
          border: 1px solid rgba(40, 90, 72, 0.5);
          border-radius: var(--radius-xl);
          overflow: hidden;
          text-align: left;
          position: relative;
        }

        .terminal-header {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-3) var(--space-4);
          background: #0a1816;
          border-bottom: 1px solid rgba(40, 90, 72, 0.4);
        }

        .terminal-dots {
          display: flex;
          gap: 6px;
        }

        .terminal-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }

        .terminal-dot.red { background: #EF4444; }
        .terminal-dot.yellow { background: #F59E0B; }
        .terminal-dot.green { background: #408A71; }

        .terminal-title {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: #408A71;
        }

        .terminal-body {
          padding: var(--space-4);
          font-family: var(--font-mono);
          font-size: 0.875rem;
          line-height: 1.7;
        }

        .terminal-line {
          white-space: pre-wrap;
          word-break: break-all;
        }

        .terminal-line.command {
          color: #B0E4CC;
        }

        .terminal-line.response {
          color: #408A71;
          margin-top: var(--space-2);
        }

        .terminal-cursor {
          color: #00D1FF;
          animation: blink 1s step-end infinite;
        }

        .scan-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(0, 209, 255, 0.4), transparent);
          animation: scan-line 3s linear infinite;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        @keyframes scan-line {
          0% { top: 0; opacity: 0; }
          10% { opacity: 0.5; }
          90% { opacity: 0.5; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </section>
  );
}
