'use client';

import { useEffect, useState } from 'react';
import { StatusPill } from '@satelink/ui';

type Health = 'operational' | 'degraded' | 'unknown';

export default function StatusPage() {
  const [lastChecked, setLastChecked] = useState<string>('');
  const [gateway, setGateway] = useState<Health>('unknown');

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('https://rpc.satelink.network/health', { cache: 'no-store', mode: 'cors' });
        if (!cancelled) setGateway(res.ok ? 'operational' : 'degraded');
      } catch {
        if (!cancelled) setGateway('degraded');
      }
      if (!cancelled) setLastChecked(new Date().toLocaleString());
    };

    check();
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // The gateway row reflects the live /health probe; billing + chain ride the
  // same backend, settlement mode is a deploy-time fact (SETTLEMENT_DRY_RUN=1).
  const services = [
    { name: 'RPC Gateway', status: gateway === 'unknown' ? 'checking' : gateway },
    { name: 'Billing System', status: gateway === 'unknown' ? 'checking' : gateway },
    { name: 'Settlement Engine', status: 'dry_run' },
    { name: 'Polygon Mainnet (Chain 137)', status: gateway === 'unknown' ? 'checking' : gateway },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Satelink Network Status
        </h1>
        <p className="numeric mt-1 text-sm text-muted-foreground">
          Last checked: {lastChecked || '—'}
          {gateway === 'degraded' ? (
            <span className="ml-2 text-state-degraded">
              (live health probe degraded)
            </span>
          ) : null}
        </p>
      </header>

      <div className="space-y-3">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="flex items-center justify-between rounded-lg border border-[hsl(var(--card-border))] bg-card px-4 py-3 transition-tokens"
          >
            <span className="text-sm font-medium">{svc.name}</span>
            <StatusPill status={svc.status} />
          </div>
        ))}
      </div>

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        For support contact{' '}
        <a
          href="mailto:support@satelink.network"
          className="text-foreground underline underline-offset-2"
        >
          support@satelink.network
        </a>
      </footer>
    </div>
  );
}
