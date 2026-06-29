'use client';

import { useEffect, useState } from 'react';

type Health = 'operational' | 'degraded' | 'unknown';

interface ServiceRow {
  name: string;
  badge: string;
  tone: 'green' | 'amber';
}

const SERVICES: ServiceRow[] = [
  { name: 'RPC Gateway', badge: 'OPERATIONAL', tone: 'green' },
  { name: 'Billing System', badge: 'OPERATIONAL', tone: 'green' },
  { name: 'Settlement Engine', badge: 'DRY_RUN', tone: 'amber' },
  { name: 'Polygon Mainnet (Chain 137)', badge: 'OPERATIONAL', tone: 'green' },
];

export default function StatusPage() {
  const [lastChecked, setLastChecked] = useState<string>('');
  const [gateway, setGateway] = useState<Health>('unknown');

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
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

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Satelink Network Status
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Last checked: {lastChecked || '—'}
          {gateway === 'degraded' ? (
            <span className="ml-2 text-amber-400">
              (live health probe degraded)
            </span>
          ) : null}
        </p>
      </header>

      <div className="space-y-3">
        {SERVICES.map((svc) => (
          <div
            key={svc.name}
            className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
          >
            <span className="text-sm font-medium">{svc.name}</span>
            <span
              className={
                svc.tone === 'green'
                  ? 'inline-flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-400'
                  : 'inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400'
              }
            >
              <span
                className={
                  svc.tone === 'green'
                    ? 'h-1.5 w-1.5 rounded-full bg-green-400'
                    : 'h-1.5 w-1.5 rounded-full bg-amber-400'
                }
              />
              {svc.badge}
            </span>
          </div>
        ))}
      </div>

      <footer className="mt-10 text-center text-xs text-zinc-500">
        For support contact{' '}
        <a
          href="mailto:support@satelink.network"
          className="text-zinc-300 underline underline-offset-2"
        >
          support@satelink.network
        </a>
      </footer>
    </div>
  );
}
