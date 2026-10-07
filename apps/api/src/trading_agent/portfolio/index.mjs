// Trading agent — portfolio subdomain (Stage 18). See ./README.md.
// Not mounted; nothing schedules the consumer, snapshotter or reconciler.
export const DOMAIN = 'portfolio';
export const TABLES = Object.freeze(['fills', 'positions', 'portfolio_snapshots', 'reconciliation_events', 'portfolio_consumer_cursors']);
export const FLAGS = Object.freeze(['TRADING_AGENT']);
export const STATUS = 'skeleton';

export { PortfolioError, PortfolioErrorCode } from './errors.mjs';
export { foldPosition, valuePosition, toMinorUnits } from './pnl.mjs';
export { FillConsumer, FILL_CONSUMER, recomputePosition, fillIdFor, positionIdFor } from './ingest.mjs';
export { PortfolioSnapshotter } from './snapshots.mjs';
export { PortfolioReconciler, RECON_ACTOR } from './reconcile.mjs';
export { PortfolioReadService } from './service.mjs';
export { InMemoryPortfolioStore, PgPortfolioStore } from './store.mjs';
export { assessPortfolioFit, correlation, PORTFOLIO_FIT_CONFIG } from './fit.mjs';
