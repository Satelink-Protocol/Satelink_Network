// apps/web/src/components/site/SiteFooter.tsx
//
// Shared footer for the standalone marketing/product/legal pages under
// app/(marketing)/ — extracted from the homepage's own <footer>
// (app/page.tsx) so Terms/Privacy/Refund/Contact and the rest of the site
// map are one click away from any public page, not just the homepage.
export function SiteFooter() {
  return (
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
                href="https://github.com/Satelink-Protocol/x402-kit"
                className="social-icon"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
              </a>
              <a href="mailto:satelinknetwork@gmail.com" className="social-icon" aria-label="Email">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M22 7l-10 6L2 7" />
                </svg>
              </a>
            </div>
          </div>

          <div className="footer-column">
            <h3 className="footer-heading">Product</h3>
            <ul className="footer-links">
              <li>
                <a href="/intelligence">Trading Intelligence</a>
              </li>
              <li>
                <a href="/pricing">Pricing</a>
              </li>
              <li>
                <a href="/status">Status Page</a>
              </li>
            </ul>
          </div>

          <div className="footer-column">
            <h3 className="footer-heading">Developers</h3>
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
                <a href="https://github.com/Satelink-Protocol/x402-kit">GitHub (x402-kit)</a>
              </li>
            </ul>
          </div>

          <div className="footer-column">
            <h3 className="footer-heading">Network</h3>
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
            <h3 className="footer-heading">Resources</h3>
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
                <a href="/terms">Terms of Service</a>
              </li>
              <li>
                <a href="/privacy">Privacy Policy</a>
              </li>
              <li>
                <a href="/refund">Refund &amp; Cancellation</a>
              </li>
              <li>
                <a href="/contact">Contact</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <p className="footer-copyright">&copy; 2026 Satelink Network. All rights reserved.</p>
          <div className="footer-legal">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="/refund">Refund &amp; Cancellation</a>
            <a href="/contact">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
