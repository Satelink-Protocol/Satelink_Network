import type { ReactNode } from 'react';

import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  breadcrumb?: string[];
  status?: ReactNode;
  actions?: ReactNode;
}

/** Page title system: icon · breadcrumb · title · subtitle · status · actions. */
export function PageHeader({
  icon,
  title,
  subtitle,
  breadcrumb,
  status,
  actions,
}: PageHeaderProps): JSX.Element {
  return (
    <div className={styles.header}>
      <div className={styles.main}>
        {icon ? <span className={styles.icon}>{icon}</span> : null}
        <div>
          {breadcrumb && breadcrumb.length > 0 ? (
            <div className={styles.crumbs}>
              {breadcrumb.map((c, i) => (
                <span key={c}>
                  {i > 0 ? <span className={styles.sep}>/</span> : null}
                  {c}
                </span>
              ))}
            </div>
          ) : null}
          <div className={styles.titleRow}>
            <span className={styles.title}>{title}</span>
            {status}
          </div>
          {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
        </div>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
