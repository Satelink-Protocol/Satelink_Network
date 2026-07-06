"use client";

import { useEffect, useState } from "react";

interface ApiStatus {
  status: string;
  uptime_pct: number;
  nodes_online: number;
  current_epoch: number;
  total_requests_24h: number;
  avg_latency_ms: number;
}

function toggleTheme() {
  const next =
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "light"
      : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("satelink-theme", next);
}

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function Home() {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [calls, setCalls] = useState(1_000_000);
  const [menuOpen, setMenuOpen] = useState(false);

  // Live metrics — real data only, from /api/status (proxied to the API).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d) => {
        if (!cancelled) setStatus(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Network canvas particle animation (ported verbatim from the approved page).
  useEffect(() => {
    const canvas = document.getElementById(
      "networkCanvas"
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId = 0;
    let particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
    }[] = [];
    const mouse = { x: null as number | null, y: null as number | null, radius: 150 };

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function createParticles() {
      if (!canvas) return;
      particles = [];
      const numParticles = Math.min(
        80,
        Math.floor((canvas.width * canvas.height) / 15000)
      );
      for (let i = 0; i < numParticles; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          radius: Math.random() * 2 + 1,
        });
      }
    }

    function animate() {
      if (!canvas || !ctx) return;
      const isDark =
        document.documentElement.getAttribute("data-theme") === "dark";
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        if (mouse.x !== null && mouse.y !== null) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < mouse.radius) {
            const force = (mouse.radius - dist) / mouse.radius;
            p.vx -= (dx / dist) * force * 0.02;
            p.vy -= (dy / dist) * force * 0.02;
          }
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? "rgba(92, 184, 154, 0.6)"
          : "rgba(64, 138, 113, 0.6)";
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = isDark
              ? `rgba(92, 184, 154, ${0.2 * (1 - dist / 150)})`
              : `rgba(64, 138, 113, ${0.15 * (1 - dist / 150)})`;
            ctx.stroke();
          }
        }
      });

      animationId = requestAnimationFrame(animate);
    }

    const onResize = () => {
      resize();
      createParticles();
    };
    const onMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onMouseOut = () => {
      mouse.x = null;
      mouse.y = null;
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseout", onMouseOut);

    resize();
    createParticles();
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseout", onMouseOut);
    };
  }, []);

  // Scroll fade-up animations.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".fade-up").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const earnings = (calls * 0.00003 * 0.5).toFixed(2);
  const requests24h =
    status != null ? status.total_requests_24h.toLocaleString("en-US") : "—";
  const nodesOnline = status != null ? String(status.nodes_online) : "—";
  // Measured values only — /api/status derives these from health-log samples
  // and returns null when there is no sample. Never render a stand-in number.
  const uptimePct =
    status != null && status.uptime_pct != null ? `${status.uptime_pct}%` : "—";
  const latencyMs =
    status != null && status.avg_latency_ms != null
      ? `${status.avg_latency_ms}ms`
      : "—";

  return (
    <>
      <canvas id="networkCanvas" />

      <header className="header">
        <div className="header-inner">
          <a href="/" className="logo">
            <div className="logo-icon">S</div>
            <span>Satelink</span>
          </a>

          <nav className="nav">
            <ul className="nav-links">
              <li>
                <a href="#products" className="nav-link">
                  Products
                </a>
              </li>
              <li>
                <a href="#pricing" className="nav-link">
                  Pricing
                </a>
              </li>
              <li>
                <a href="/node" className="nav-link">
                  Node Operators
                </a>
              </li>
              <li>
                <a href="/docs" className="nav-link">
                  Docs
                </a>
              </li>
              <li>
                <a href="/status" className="nav-link">
                  Status
                </a>
              </li>
            </ul>
          </nav>

          <div className="nav-actions">
            <button
              className="theme-btn"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              <svg className="sun" viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
              <svg className="moon" viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            </button>
            <a href="/satelink/os/mission-control" className="btn btn-ghost">
              Login
            </a>
            <a href="/satelink/os/keys" className="btn btn-primary">
              Get API Key
            </a>
          </div>

          <button
            className="mobile-menu-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobileNav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? (
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile navigation drawer — the hamburger previously had no handler */}
        {menuOpen && (
          <nav id="mobileNav" className="mobile-nav" aria-label="Mobile">
            {[
              { href: "#products", label: "Products" },
              { href: "#pricing", label: "Pricing" },
              { href: "/node", label: "Node Operators" },
              { href: "/docs", label: "Docs" },
              { href: "/status", label: "Status" },
              { href: "/satelink/os/mission-control", label: "Login" },
              { href: "/satelink/os/keys", label: "Get API Key" },
            ].map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="mobile-nav-link"
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </a>
            ))}
          </nav>
        )}
      </header>

      <main>
        {/* Hero */}
        <section className="hero">
          <div className="hero-grid" />
          <div className="container">
            <div className="hero-content">
              <div className="hero-badge fade-up">
                <span className="badge-dot" />
                Live on Polygon PoS Mainnet
              </div>

              <h1 className="hero-title fade-up">
                Pay-per-call RPC for the
                <br />
                <span className="hero-title-gradient">
                  Machine Economy
                </span>
              </h1>

              <p className="hero-subtitle fade-up">
                A DePIN RPC gateway with on-chain USDT metering. Developers and
                autonomous machines pay $0.00003 per call — no subscriptions,
                no accounts, one HTTP 402 away from your first request.
              </p>

              <div className="hero-cta fade-up">
                <a
                  href="/satelink/os/mission-control"
                  className="btn btn-primary btn-lg"
                >
                  Launch Console
                  <ArrowIcon />
                </a>
                <a href="/docs" className="btn btn-secondary btn-lg">
                  View Docs
                </a>
                <a href="/node" className="btn btn-ghost btn-lg">
                  Run a Node
                </a>
              </div>

              <div className="hero-metrics fade-up">
                <div className="metric-card">
                  <div className="metric-value" id="metricCalls">
                    {requests24h}
                  </div>
                  <div className="metric-label">API Requests (today)</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value" id="metricNodes">
                    {nodesOnline}
                  </div>
                  <div className="metric-label">Active Nodes</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value" id="metricUptime">
                    {uptimePct}
                  </div>
                  <div className="metric-label">Measured Uptime (24h)</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value" id="metricLatency">
                    {latencyMs}
                  </div>
                  <div className="metric-label">p50 Latency (24h)</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Live network — real numbers from /api/status; no invented social proof */}
        <section className="section social-proof">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Live Network</div>
              <h2 className="section-title">Numbers You Can Verify</h2>
              <p className="section-subtitle">
                Every figure below is fetched live from the gateway API and
                backed by on-chain settlement records — nothing is a marketing
                estimate.
              </p>
            </div>

            <div className="social-stats fade-up">
              <div className="social-stat">
                <div className="social-stat-value">{requests24h}</div>
                <div className="social-stat-label">API Calls Today</div>
              </div>
              <div className="social-stat">
                <div className="social-stat-value">{nodesOnline}</div>
                <div className="social-stat-label">Active Nodes</div>
              </div>
              <div className="social-stat">
                <div className="social-stat-value">{uptimePct}</div>
                <div className="social-stat-label">Measured Uptime (24h)</div>
              </div>
              <div className="social-stat">
                <div className="social-stat-value">{latencyMs}</div>
                <div className="social-stat-label">p50 Latency (24h)</div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="section" id="features">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Why Satelink</div>
              <h2 className="section-title">Everything You Need to Build</h2>
            </div>

            <div className="features-grid fade-up">
              <div className="feature-card">
                <div className="feature-icon">&#9889;</div>
                <h3 className="feature-title">Low Latency</h3>
                <p className="feature-desc">
                  Measured p50 response times published live on the status
                  page — no marketing averages.
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">&#128176;</div>
                <h3 className="feature-title">Pay Per Call</h3>
                <p className="feature-desc">
                  No monthly fees. Just $0.000030 per call. Only pay for what
                  you use.
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">&#128279;</div>
                <h3 className="feature-title">Multi-Chain</h3>
                <p className="feature-desc">
                  Ethereum, Polygon, Base, Arbitrum. One API key, all chains.
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">&#128274;</div>
                <h3 className="feature-title">Secure</h3>
                <p className="feature-desc">
                  On-chain settlement, no custody. Your funds never touch
                  centralized systems.
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">&#128200;</div>
                <h3 className="feature-title">Transparent</h3>
                <p className="feature-desc">
                  All transactions on Polygonscan. Verify every settlement
                  yourself.
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">&#127758;</div>
                <h3 className="feature-title">Permissionless</h3>
                <p className="feature-desc">
                  Anyone can deposit USDT to buy capacity, and anyone can
                  register a node to serve it. No sales calls, no approval.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Competitor Comparison */}
        <section className="section comparison-section">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Compare</div>
              <h2 className="section-title">Why Choose Satelink?</h2>
            </div>

            <table className="comparison-table fade-up">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th className="satelink-col">Satelink</th>
                  <th>Infura</th>
                  <th>Alchemy</th>
                  <th>QuickNode</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Cost per 1M calls</td>
                  <td className="satelink-col">
                    <strong>$30 flat</strong>
                  </td>
                  <td>varies by plan</td>
                  <td>varies by plan</td>
                  <td>varies by plan</td>
                </tr>
                <tr>
                  <td>Decentralized</td>
                  <td className="satelink-col">
                    <span className="check">&#10003;</span>
                  </td>
                  <td>
                    <span className="cross">&#10005;</span>
                  </td>
                  <td>
                    <span className="cross">&#10005;</span>
                  </td>
                  <td>
                    <span className="cross">&#10005;</span>
                  </td>
                </tr>
                <tr>
                  <td>Node Operator Rewards</td>
                  <td className="satelink-col">
                    <span className="check">&#10003;</span>
                  </td>
                  <td>
                    <span className="cross">&#10005;</span>
                  </td>
                  <td>
                    <span className="cross">&#10005;</span>
                  </td>
                  <td>
                    <span className="cross">&#10005;</span>
                  </td>
                </tr>
                <tr>
                  <td>On-Chain Settlement</td>
                  <td className="satelink-col">
                    <span className="check">&#10003;</span>
                  </td>
                  <td>
                    <span className="cross">&#10005;</span>
                  </td>
                  <td>
                    <span className="cross">&#10005;</span>
                  </td>
                  <td>
                    <span className="cross">&#10005;</span>
                  </td>
                </tr>
                <tr>
                  <td>Free Tier</td>
                  <td className="satelink-col">500 calls/day</td>
                  <td>plan-based</td>
                  <td>plan-based</td>
                  <td>plan-based</td>
                </tr>
              </tbody>
            </table>

            <div style={{ textAlign: "center", marginTop: 32 }} className="fade-up">
              <a href="/docs/pricing" className="btn btn-secondary">
                Full Pricing Details
              </a>
            </div>
          </div>
        </section>

        {/* Proof */}
        <section className="section proof" id="proof">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Proven Infrastructure</div>
              <h2 className="section-title">Verified On-Chain</h2>
              <p className="section-subtitle">
                Real revenue. Real settlements. All verifiable on blockchain.
              </p>
            </div>

            <div className="proof-grid">
              <div className="proof-card fade-up">
                <div className="proof-icon">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <h3 className="proof-title">First USDT Claim</h3>
                <p className="proof-desc">
                  Historical first settlement claim of $1.296464, verified on
                  Polygon mainnet — the proof-of-concept that the settlement
                  path works end to end.
                </p>
                <a
                  href="https://polygonscan.com/tx/0x814d348d3f6cb4164d2aadf99b574d4ca65221d2155a76b0e99a4e8641a1726b"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="proof-link"
                >
                  View Transaction
                  <ArrowIcon />
                </a>
              </div>

              <div className="proof-card fade-up">
                <div className="proof-icon">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
                <h3 className="proof-title">RevenueVault V2</h3>
                <p className="proof-desc">
                  The production vault contract on Polygon. Permissionless USDT
                  deposits credit your account on-chain — verify every deposit
                  yourself.
                </p>
                <a
                  href="https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="proof-link"
                >
                  View Contract
                  <ArrowIcon />
                </a>
              </div>

              <div className="proof-card fade-up">
                <div className="proof-icon">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                </div>
                <h3 className="proof-title">Open Source</h3>
                <p className="proof-desc">
                  Full codebase on GitHub. Transparent development,
                  community-driven, verifiable.
                </p>
                <a
                  href="https://github.com/Satelink-Protocol/Satelink_Network"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="proof-link"
                >
                  View Repository
                  <ArrowIcon />
                </a>
              </div>
            </div>

            <div className="proof-footer fade-up">
              <a
                href="https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF"
                target="_blank"
                rel="noopener noreferrer"
              >
                All deposits verifiable on Polygonscan &#8594;
              </a>
            </div>
          </div>
        </section>

        {/* Products */}
        <section className="section" id="products">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Products</div>
              <h2 className="section-title">Infrastructure You Can Build On</h2>
              <p className="section-subtitle">
                Decentralized infrastructure services with transparent pricing
                and on-chain settlement.
              </p>
            </div>

            <div className="products-grid">
              <div className="product-card fade-up">
                <span className="product-badge">Live</span>
                <h3 className="product-title">RPC Gateway</h3>
                <p className="product-desc">
                  Multi-chain RPC across Polygon, Ethereum, Base, and Arbitrum
                  with provider health monitoring, circuit breakers, and
                  automatic failover.
                </p>
                <a href="/docs/api-reference" className="product-link">
                  API Reference
                  <ArrowIcon />
                </a>
              </div>

              <div className="product-card fade-up">
                <span className="product-badge coming">Roadmap</span>
                <h3 className="product-title">AI Inference Proxy</h3>
                <p className="product-desc">
                  Planned: route AI workloads to distributed GPUs with the same
                  pay-per-call USDT metering. Not yet available.
                </p>
                <a href="#roadmap" className="product-link">
                  View Roadmap
                  <ArrowIcon />
                </a>
              </div>

              <div className="product-card fade-up">
                <span className="product-badge coming">Roadmap</span>
                <h3 className="product-title">Webhook Delivery</h3>
                <p className="product-desc">
                  Planned: reliable webhook routing with automatic retries and
                  dead-letter queues. Not yet available.
                </p>
                <a href="#roadmap" className="product-link">
                  View Roadmap
                  <ArrowIcon />
                </a>
              </div>

              <div className="product-card fade-up">
                <span className="product-badge coming">Roadmap</span>
                <h3 className="product-title">Compute Jobs</h3>
                <p className="product-desc">
                  Planned: serverless functions on distributed nodes with
                  per-second billing. Not yet available.
                </p>
                <a href="#roadmap" className="product-link">
                  View Roadmap
                  <ArrowIcon />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works with Diagrams */}
        <section className="section how-section">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">How It Works</div>
              <h2 className="section-title">
                Simple, Transparent, Decentralized
              </h2>
            </div>

            <div className="how-diagrams fade-up">
              {/* Request Flow Diagram */}
              <div className="diagram-card">
                <h4 className="diagram-title">Request Flow</h4>
                <svg className="diagram-svg" viewBox="0 0 280 160">
                  <defs>
                    <marker
                      id="arrowhead1"
                      markerWidth="10"
                      markerHeight="7"
                      refX="9"
                      refY="3.5"
                      orient="auto"
                    >
                      <polygon points="0 0, 10 3.5, 0 7" fill="#5CB89A" />
                    </marker>
                  </defs>
                  <rect className="node" x="10" y="60" width="50" height="40" rx="6" />
                  <text x="35" y="85" textAnchor="middle" fontSize="10">
                    Dev
                  </text>
                  <line
                    className="arrow arrow-animated"
                    x1="65"
                    y1="80"
                    x2="90"
                    y2="80"
                    markerEnd="url(#arrowhead1)"
                  />
                  <rect className="node" x="95" y="60" width="50" height="40" rx="6" />
                  <text x="120" y="85" textAnchor="middle" fontSize="10">
                    Gateway
                  </text>
                  <line
                    className="arrow arrow-animated"
                    x1="150"
                    y1="80"
                    x2="175"
                    y2="80"
                    markerEnd="url(#arrowhead1)"
                  />
                  <rect className="node" x="180" y="60" width="50" height="40" rx="6" />
                  <text x="205" y="85" textAnchor="middle" fontSize="10">
                    Node
                  </text>
                  <line
                    className="arrow"
                    x1="235"
                    y1="80"
                    x2="260"
                    y2="80"
                    markerEnd="url(#arrowhead1)"
                  />
                  <text x="270" y="85" textAnchor="middle" fontSize="10" fill="#5CB89A">
                    &#10003;
                  </text>
                  <text x="140" y="140" textAnchor="middle" fontSize="11" fill="#9BA1A6">
                    Automatic failover to nearest node
                  </text>
                </svg>
              </div>

              {/* Settlement Flow Diagram */}
              <div className="diagram-card">
                <h4 className="diagram-title">Settlement Flow</h4>
                <svg className="diagram-svg" viewBox="0 0 280 160">
                  <rect className="node" x="10" y="30" width="55" height="35" rx="6" />
                  <text x="37" y="52" textAnchor="middle" fontSize="9">
                    Revenue
                  </text>
                  <line
                    className="arrow arrow-animated"
                    x1="70"
                    y1="47"
                    x2="85"
                    y2="47"
                    markerEnd="url(#arrowhead1)"
                  />
                  <rect className="node" x="90" y="30" width="55" height="35" rx="6" />
                  <text x="117" y="52" textAnchor="middle" fontSize="9">
                    Epoch
                  </text>
                  <line
                    className="arrow arrow-animated"
                    x1="150"
                    y1="47"
                    x2="165"
                    y2="47"
                    markerEnd="url(#arrowhead1)"
                  />
                  <rect className="node" x="170" y="30" width="55" height="35" rx="6" />
                  <text x="197" y="52" textAnchor="middle" fontSize="9">
                    Merkle
                  </text>
                  <line
                    className="arrow arrow-animated"
                    x1="230"
                    y1="47"
                    x2="245"
                    y2="47"
                    markerEnd="url(#arrowhead1)"
                  />
                  <rect
                    className="node"
                    x="10"
                    y="90"
                    width="55"
                    height="35"
                    rx="6"
                    style={{ fill: "rgba(92,184,154,0.2)" }}
                  />
                  <text x="37" y="112" textAnchor="middle" fontSize="9">
                    Claim
                  </text>
                  <line
                    className="arrow"
                    x1="85"
                    y1="107"
                    x2="70"
                    y2="107"
                    markerEnd="url(#arrowhead1)"
                    transform="rotate(180 77 107)"
                  />
                  <rect className="node" x="90" y="90" width="55" height="35" rx="6" />
                  <text x="117" y="112" textAnchor="middle" fontSize="9">
                    Polygon TX
                  </text>
                  <line
                    className="arrow"
                    x1="165"
                    y1="107"
                    x2="150"
                    y2="107"
                    markerEnd="url(#arrowhead1)"
                    transform="rotate(180 157 107)"
                  />
                  <rect className="node" x="170" y="90" width="55" height="35" rx="6" />
                  <text x="197" y="112" textAnchor="middle" fontSize="9">
                    Verify
                  </text>
                  <path
                    className="arrow"
                    d="M255 47 L265 47 L265 107 L230 107"
                    markerEnd="url(#arrowhead1)"
                    fill="none"
                    stroke="#5CB89A"
                    strokeWidth="2"
                  />
                  <text x="140" y="150" textAnchor="middle" fontSize="11" fill="#9BA1A6">
                    Epochs aggregate ~10 min · settle on Polygon
                  </text>
                </svg>
              </div>

              {/* Revenue Split Diagram */}
              <div className="diagram-card">
                <h4 className="diagram-title">Revenue Split</h4>
                <svg className="diagram-svg" viewBox="0 0 280 160">
                  <circle cx="140" cy="70" r="55" fill="none" stroke="#2D5A4A" strokeWidth="20" />
                  <circle
                    cx="140"
                    cy="70"
                    r="55"
                    fill="none"
                    stroke="#408A71"
                    strokeWidth="20"
                    strokeDasharray="103.67 242.89"
                    strokeDashoffset="0"
                    transform="rotate(-90 140 70)"
                  />
                  <circle
                    cx="140"
                    cy="70"
                    r="55"
                    fill="none"
                    stroke="#5CB89A"
                    strokeWidth="20"
                    strokeDasharray="172.79 172.79"
                    strokeDashoffset="0"
                    transform="rotate(-90 140 70)"
                  />
                  <text x="140" y="68" textAnchor="middle" fontSize="20" fontWeight="700" fill="#ECEDEE">
                    50%
                  </text>
                  <text x="140" y="85" textAnchor="middle" fontSize="10" fill="#9BA1A6">
                    Nodes
                  </text>
                  <rect x="20" y="135" width="12" height="12" rx="2" fill="#5CB89A" />
                  <text x="38" y="145" fontSize="10" fill="#9BA1A6">
                    50% Nodes
                  </text>
                  <rect x="110" y="135" width="12" height="12" rx="2" fill="#408A71" />
                  <text x="128" y="145" fontSize="10" fill="#9BA1A6">
                    30% Platform
                  </text>
                  <rect x="210" y="135" width="12" height="12" rx="2" fill="#2D5A4A" />
                  <text x="228" y="145" fontSize="10" fill="#9BA1A6">
                    20% Pool
                  </text>
                </svg>
              </div>
            </div>

            <div className="how-flow fade-up">
              <div className="how-step">
                <div className="how-step-icon">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </div>
                <h3 className="how-step-title">Developers</h3>
                <p className="how-step-desc">
                  Pay per API call with USDT. No subscriptions.
                </p>
              </div>

              <div className="how-arrow">&#8594;</div>

              <div className="how-step">
                <div className="how-step-icon">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </div>
                <h3 className="how-step-title">Platform</h3>
                <p className="how-step-desc">
                  Routes calls, meters usage, and aggregates revenue into
                  on-chain settlement epochs.
                </p>
              </div>

              <div className="how-arrow">&#8594;</div>

              <div className="how-step">
                <div className="how-step-icon">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <h3 className="how-step-title">Node Operators</h3>
                <p className="how-step-desc">
                  Earn 50% of revenue. Claim USDT anytime.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Live Stats */}
        <section className="section" id="stats">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Live Network</div>
              <h2 className="section-title">Real-Time Statistics</h2>
              <p className="section-subtitle">
                Transparent metrics. Everything verifiable on-chain.
              </p>
            </div>

            <div className="stats-grid fade-up">
              <div className="stat-card">
                <div className="stat-label">Active Nodes</div>
                <div className="stat-value">{nodesOnline}</div>
                <div className="stat-subtitle">Permissionless onboarding open</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Measured Uptime</div>
                <div className="stat-value green">{uptimePct}</div>
                <div className="stat-subtitle">Last 24 hours</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">p50 Latency</div>
                <div className="stat-value">{latencyMs}</div>
                <div className="stat-subtitle">Last 24 hours</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">API Requests</div>
                <div className="stat-value green">{requests24h}</div>
                <div className="stat-subtitle">Last 24 hours</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Current Epoch</div>
                <div className="stat-value">
                  {status != null ? status.current_epoch.toLocaleString("en-US") : "—"}
                </div>
                <div className="stat-subtitle">Settles continuously</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Metered Rate</div>
                <div className="stat-value">$0.00003</div>
                <div className="stat-subtitle">Per call, USDT</div>
              </div>
            </div>

            <div className="stats-footer fade-up">
              <a href="/status">
                View Full Status Page
                <ArrowIcon />
              </a>
            </div>
          </div>
        </section>

        {/* Code Example */}
        <section className="section code-section">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Developer Experience</div>
              <h2 className="section-title">2 Minutes to First Call</h2>
            </div>

            <div className="code-container fade-up">
              <div className="code-window">
                <div className="code-header">
                  <span className="code-dot red" />
                  <span className="code-dot yellow" />
                  <span className="code-dot green" />
                  <span className="code-title">terminal</span>
                </div>
                <div className="code-body">
                  <span className="code-comment"># Install SDK</span>
                  {"\nnpm install @satelink/sdk\n\n"}
                  <span className="code-comment"># Make your first RPC call</span>
                  {"\n"}
                  <span className="code-keyword">import</span>
                  {" { Satelink } "}
                  <span className="code-keyword">from</span>{" "}
                  <span className="code-string">&apos;@satelink/sdk&apos;</span>
                  {";\n\n"}
                  <span className="code-keyword">const</span>{" "}
                  <span className="code-const">satelink</span>
                  {" = "}
                  <span className="code-keyword">new</span>{" "}
                  <span className="code-function">Satelink</span>
                  {"("}
                  <span className="code-string">&apos;YOUR_API_KEY&apos;</span>
                  {");\n\n"}
                  <span className="code-keyword">const</span>{" "}
                  <span className="code-const">block</span>
                  {" = "}
                  <span className="code-keyword">await</span>
                  {" satelink.rpc.polygon."}
                  <span className="code-function">eth_blockNumber</span>
                  {"();\nconsole."}
                  <span className="code-function">log</span>
                  {"("}
                  <span className="code-string">&apos;Current block:&apos;</span>
                  {", block);"}
                </div>
              </div>
            </div>

            <div className="code-cta fade-up">
              <a href="/satelink/os/keys" className="btn btn-primary btn-lg">
                Get API Key
                <ArrowIcon />
              </a>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="section" id="pricing">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Pricing</div>
              <h2 className="section-title">Simple, Transparent Pricing</h2>
              <p className="section-subtitle">
                Pay for what you use. No subscriptions. No hidden fees.
              </p>
            </div>

            <div className="pricing-grid fade-up">
              <div className="pricing-card">
                <div className="pricing-tier">Free</div>
                <div className="pricing-price">
                  $0<span>/month</span>
                </div>
                <p className="pricing-desc">
                  Perfect for testing and small projects
                </p>
                <ul className="pricing-features">
                  <li>
                    <CheckIcon /> 500 requests/day per IP
                  </li>
                  <li>
                    <CheckIcon /> All chains included
                  </li>
                  <li>
                    <CheckIcon /> No account required
                  </li>
                  <li>
                    <CheckIcon /> No credit card required
                  </li>
                </ul>
                <a href="/satelink/os/keys" className="btn btn-secondary pricing-cta">
                  Start Free
                </a>
              </div>

              <div className="pricing-card featured">
                <div className="pricing-tier">Pay as you go</div>
                <div className="pricing-price">
                  $0.00003<span>/call</span>
                </div>
                <p className="pricing-desc">
                  For production workloads at any scale
                </p>
                <ul className="pricing-features">
                  <li>
                    <CheckIcon /> $1 &asymp; 33,333 calls
                  </li>
                  <li>
                    <CheckIcon /> Permissionless USDT deposits
                  </li>
                  <li>
                    <CheckIcon /> Credits never expire
                  </li>
                  <li>
                    <CheckIcon /> On-chain deposit verification
                  </li>
                </ul>
                <a href="/satelink/os/deposit" className="btn btn-primary pricing-cta">
                  Get Started
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Node Operators */}
        <section className="section node-section" id="nodes">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Node Operators</div>
              <h2 className="section-title">
                Earn USDT by Running Infrastructure
              </h2>
              <p className="section-subtitle">
                50% of all revenue goes directly to node operators. Claim
                anytime.
              </p>
            </div>

            <div className="node-grid">
              <div className="calculator fade-up">
                <h3 className="calculator-title">Earnings Calculator</h3>

                <div className="calc-slider">
                  <div className="calc-label">
                    <span>Monthly API Calls</span>
                    <span className="calc-value" id="callsValue">
                      {calls.toLocaleString("en-US")}
                    </span>
                  </div>
                  <input
                    type="range"
                    id="callsSlider"
                    min="100000"
                    max="10000000"
                    value={calls}
                    step="100000"
                    onChange={(e) => setCalls(parseInt(e.target.value, 10))}
                  />
                </div>

                <div className="calc-result">
                  <div className="calc-result-label">
                    Estimated Monthly Earnings
                  </div>
                  <div className="calc-result-value" id="earningsValue">
                    ${earnings}
                  </div>
                </div>

                <div style={{ textAlign: "center", marginTop: 24 }}>
                  <a href="/node/earnings" className="btn btn-secondary">
                    View Live Earnings
                  </a>
                </div>
              </div>

              <div className="requirements fade-up">
                <h3 className="requirements-title">Requirements</h3>
                <ul className="req-list">
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                    VPS or home server
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                      <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    2GB RAM minimum
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                    </svg>
                    50GB storage
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                    </svg>
                    Public IP address
                  </li>
                </ul>
                <div className="node-cta">
                  <a href="/node/setup" className="btn btn-primary btn-lg">
                    Run a Node
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Settlement */}
        <section className="section" id="settlement">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Settlement</div>
              <h2 className="section-title">Autonomous On-Chain Settlement</h2>
              <p className="section-subtitle">
                Transparent revenue distribution. Verifiable on Polygon.
              </p>
            </div>

            <div className="settlement-visual fade-up">
              <div className="split-bars">
                <div className="split-bar nodes">50%</div>
                <div className="split-bar platform">30%</div>
                <div className="split-bar pool">20%</div>
              </div>
              <div className="split-legend">
                <div className="legend-item">
                  <span className="legend-dot nodes" /> Node Operators
                </div>
                <div className="legend-item">
                  <span className="legend-dot platform" /> Platform Fee
                </div>
                <div className="legend-item">
                  <span className="legend-dot pool" /> Distribution Pool
                </div>
              </div>
            </div>

            <div className="contract-card fade-up">
              <div className="contract-info">
                <div className="contract-label">RevenueVault V2</div>
                <div className="contract-value">
                  <a
                    href="https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    0x577D3716d6Ad5b676d230f5409deF9838FABaCEF
                  </a>
                </div>
              </div>
              <div className="contract-info">
                <div className="contract-label">Network</div>
                <div className="contract-value">Polygon PoS (Chain ID 137)</div>
              </div>
              <div className="contract-info">
                <div className="contract-label">Settlement Token</div>
                <div className="contract-value">USDT</div>
              </div>
            </div>
          </div>
        </section>

        {/* Roadmap */}
        <section className="section roadmap-section" id="roadmap">
          <div className="container">
            <div className="section-header fade-up">
              <div className="section-eyebrow">Roadmap</div>
              <h2 className="section-title">Building the Future</h2>
              <p className="section-subtitle">
                Transparent progress. Ship fast, iterate faster.
              </p>
            </div>

            <div className="roadmap-timeline">
              <div className="roadmap-item done fade-up">
                <div className="roadmap-dot" />
                <div className="roadmap-content">
                  <div className="roadmap-header">
                    <span className="roadmap-stage">Completed</span>
                    <span className="roadmap-status done">Shipped</span>
                  </div>
                  <h3 className="roadmap-title">Core Economic Engine</h3>
                  <p className="roadmap-desc">
                    RPC gateway with per-call USDT metering, credit system with
                    permissionless RevenueVault deposits, epoch-based revenue
                    ledger, wallet + API-key authentication, HTTP 402 machine
                    onboarding, admin command center, node and developer
                    portals, live status page, and monitoring.
                  </p>
                </div>
              </div>

              <div className="roadmap-item active fade-up">
                <div className="roadmap-dot" />
                <div className="roadmap-content">
                  <div className="roadmap-header">
                    <span className="roadmap-stage">In Progress</span>
                    <span className="roadmap-status progress">Active</span>
                  </div>
                  <h3 className="roadmap-title">Production Hardening</h3>
                  <p className="roadmap-desc">
                    Settlement automation is in final verification (dry-run
                    mode). Active work: customer onboarding polish,
                    documentation overhaul, infrastructure dashboards, and
                    data-truth verification across every surface.
                  </p>
                </div>
              </div>

              <div className="roadmap-item fade-up">
                <div className="roadmap-dot" />
                <div className="roadmap-content">
                  <div className="roadmap-header">
                    <span className="roadmap-stage">Next</span>
                    <span className="roadmap-status planned">Milestones</span>
                  </div>
                  <h3 className="roadmap-title">Scale the Two-Sided Market</h3>
                  <p className="roadmap-desc">
                    Grow external paying customers, first fully autonomous
                    machine-to-machine payment, public node operator
                    onboarding at scale, and multi-provider execution.
                  </p>
                </div>
              </div>

              <div className="roadmap-item fade-up">
                <div className="roadmap-dot" />
                <div className="roadmap-content">
                  <div className="roadmap-header">
                    <span className="roadmap-stage">Planned</span>
                    <span className="roadmap-status planned">Roadmap</span>
                  </div>
                  <h3 className="roadmap-title">Expanded Workload Marketplace</h3>
                  <p className="roadmap-desc">
                    Beyond RPC: AI inference proxy, webhook delivery, and
                    distributed compute jobs — each with the same transparent
                    on-chain metering. Timelines depend on network growth.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="cta-section">
          <div className="container">
            <div className="cta-card fade-up">
              <h2 className="cta-title">
                Start Building on Decentralized Infrastructure
              </h2>
              <p className="cta-subtitle">
                Join developers and node operators building the decentralized
                internet. Get your API key in seconds.
              </p>
              <div className="cta-buttons">
                <a href="/satelink/os/keys" className="btn btn-primary btn-lg">
                  Get API Key
                </a>
                <a href="/docs" className="btn btn-secondary btn-lg">
                  Read Documentation
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <div className="footer-logo">
                <div className="logo-icon">S</div>
                <span>Satelink</span>
              </div>
              <p className="footer-tagline">
                Decentralized infrastructure for the next generation of
                applications. Real workloads. Real revenue.
              </p>
              <div className="footer-social">
                <a
                  href="https://github.com/Satelink-Protocol/Satelink_Network"
                  className="social-icon"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                </a>
                <a
                  href="mailto:satelinknetwork@gmail.com"
                  className="social-icon"
                  aria-label="Email"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M22 7l-10 6L2 7" />
                  </svg>
                </a>
              </div>
            </div>

            <div className="footer-column">
              <h4>Product</h4>
              <ul className="footer-links">
                <li>
                  <a href="#products">RPC Gateway</a>
                </li>
                <li>
                  <a href="#pricing">Pricing</a>
                </li>
                <li>
                  <a href="#roadmap">Roadmap</a>
                </li>
                <li>
                  <a href="/status">Status Page</a>
                </li>
              </ul>
            </div>

            <div className="footer-column">
              <h4>Developers</h4>
              <ul className="footer-links">
                <li>
                  <a href="/docs">Documentation</a>
                </li>
                <li>
                  <a href="/docs/api-reference">API Reference</a>
                </li>
                <li>
                  <a href="/docs/quick-start">Quick Start</a>
                </li>
                <li>
                  <a href="https://github.com/Satelink-Protocol/Satelink_Network">
                    GitHub
                  </a>
                </li>
              </ul>
            </div>

            <div className="footer-column">
              <h4>Network</h4>
              <ul className="footer-links">
                <li>
                  <a href="/node">Node Operators</a>
                </li>
                <li>
                  <a href="/machine">Machine Economy</a>
                </li>
                <li>
                  <a href="/docs/revenue-model">Revenue Model</a>
                </li>
                <li>
                  <a href="https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF">
                    Vault on Polygonscan
                  </a>
                </li>
              </ul>
            </div>

            <div className="footer-column">
              <h4>Resources</h4>
              <ul className="footer-links">
                <li>
                  <a href="/docs/faq">FAQ</a>
                </li>
                <li>
                  <a href="/docs/changelog">Changelog</a>
                </li>
                <li>
                  <a href="/docs/security">Security</a>
                </li>
                <li>
                  <a href="mailto:satelinknetwork@gmail.com">Contact</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <p className="footer-copyright">
              &copy; 2026 Satelink Network. All rights reserved.
            </p>
            <div className="footer-legal">
              <a href="/privacy.html">Privacy Policy</a>
              <a href="/terms.html">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
