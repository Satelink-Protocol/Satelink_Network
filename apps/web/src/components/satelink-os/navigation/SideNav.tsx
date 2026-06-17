import clsx from 'clsx';

import styles from './SideNav.module.css';

export interface NavItem {
  id: string;
  icon: string;
  label: string;
}

export interface SideNavProps {
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Enterprise left navigation — typed item model, collapsible, active-aware. */
export function SideNav({
  items,
  activeId,
  onSelect,
  collapsed,
  onToggleCollapse,
}: SideNavProps): JSX.Element {
  return (
    <nav className={clsx(styles.nav, collapsed && styles.collapsed)}>
      <div className={styles.brand}>◈</div>
      <div className={styles.items}>
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              className={clsx(styles.item, active && styles.active)}
              onClick={() => onSelect(item.id)}
            >
              <span className={styles.icon}>{item.icon}</span>
              <span className={styles.label}>
                {collapsed ? item.label.slice(0, 3).toUpperCase() : item.label}
              </span>
            </button>
          );
        })}
      </div>
      {onToggleCollapse ? (
        <button type="button" className={styles.collapseBtn} onClick={onToggleCollapse} title="Toggle navigation">
          {collapsed ? '»' : '«'}
        </button>
      ) : null}
    </nav>
  );
}
