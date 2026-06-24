import type { ReactNode } from 'react';
import clsx from 'clsx';

import { PageHeader, type PageHeaderProps } from '../layout/PageHeader';
import { TopBar, type TopBarProps } from '../layout/TopBar';
import { SideNav, type NavItem } from '../navigation/SideNav';
import styles from './AppShell.module.css';

export interface AppShellProps {
  nav: {
    items: NavItem[];
    activeId: string;
    onSelect: (id: string) => void;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
  };
  topbar: TopBarProps;
  header: PageHeaderProps;
  children: ReactNode;
}

/**
 * SigNoz-style shell: SideNav + persistent TopBar + PageHeader + scroll content.
 * The `sat-os` class scopes the theme variables (also set by the route layout).
 */
export function AppShell({ nav, topbar, header, children }: AppShellProps): JSX.Element {
  return (
    <div className={clsx('sat-os', styles.shell)}>
      <SideNav {...nav} />
      <div className={styles.main}>
        <TopBar {...topbar} />
        <PageHeader {...header} />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
