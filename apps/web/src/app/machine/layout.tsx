'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DashboardShell, type ShellNavGroup, type ShellSearchItem } from '@satelink/ui';
import {
  LayoutDashboard,
  Database,
  Network,
  BarChart3,
  Wallet,
  Bot,
  DollarSign,
  RefreshCcw,
  Zap,
  Satellite,
} from 'lucide-react';

// Machine economy navigation for machine.satelink.network. Each id maps to a
// view rendered by the single-page portal at /machine, addressed via ?view=.
const MACHINE_NAV: ShellNavGroup[] = [
  {
    label: 'Machine Economy',
    items: [
      { id: 'mission-control', icon: LayoutDashboard, label: 'Mission Control' },
      { id: 'registry', icon: Database, label: 'Machine Registry' },
      { id: 'protocols', icon: Network, label: 'Protocol Customers' },
      { id: 'consumption', icon: BarChart3, label: 'Consumption Analytics' },
      { id: 'wallets', icon: Wallet, label: 'Machine Wallets' },
      { id: 'agents', icon: Bot, label: 'Agent Fleet' },
      { id: 'attribution', icon: DollarSign, label: 'Revenue Attribution' },
      { id: 'settlement', icon: RefreshCcw, label: 'Settlement' },
      { id: 'autonomous', icon: Zap, label: 'Autonomous Economy' },
    ],
  },
];

const SEARCH_ITEMS: ShellSearchItem[] = MACHINE_NAV[0].items.map((i) => ({
  id: i.id,
  label: i.label,
  icon: i.icon,
  group: 'Machine Economy',
}));

function MachineShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get('view') || 'mission-control';

  const go = (id: string) =>
    router.push(id === 'mission-control' ? '/machine' : `/machine?view=${id}`);

  const activeLabel =
    MACHINE_NAV[0].items.find((i) => i.id === view)?.label ?? 'Mission Control';

  return (
    <DashboardShell
      brand={{ name: 'Satelink Machine', sublabel: 'Autonomous Economy', logo: Satellite }}
      nav={MACHINE_NAV}
      activeId={view}
      onNavigate={go}
      breadcrumb={['Satelink', 'Machine', activeLabel]}
      title="Machine Economy"
      subtitle="Autonomous infrastructure for agents, bots, and protocols"
      search={{
        items: SEARCH_ITEMS,
        onSelect: go,
        placeholder: 'Search machine economy…',
      }}
    >
      {children}
    </DashboardShell>
  );
}

export default function MachineLayout({ children }: { children: React.ReactNode }) {
  // useSearchParams must sit inside a Suspense boundary for static prerender.
  return (
    <Suspense fallback={null}>
      <MachineShell>{children}</MachineShell>
    </Suspense>
  );
}
