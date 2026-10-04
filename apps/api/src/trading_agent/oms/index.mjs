// Trading agent — OMS subdomain (Stage 17). See ./README.md.
// Not mounted; nothing runs the dispatcher or reconciler yet.
export const DOMAIN = 'oms';
export const TABLES = Object.freeze(['orders', 'order_events', 'trading_outbox']);
export const FLAGS = Object.freeze(['TRADING_AGENT']);
export const STATUS = 'skeleton';

export { OmsError, OmsErrorCode, SimulatedCrash } from './errors.mjs';
export { OmsState, DB_STATUS, TRANSITIONS, TERMINAL, FROM_BROKER, stateOf, canTransition, assertTransition, isForward } from './states.mjs';
export { clientOrderIdFor, VENUE_CLIENT_ID_MAX, CLIENT_ID_PREFIX } from './client_order_id.mjs';
export { OrderAcceptanceService, assertExactlyOnceCapable } from './acceptance.mjs';
export { OrderDispatcher } from './dispatcher.mjs';
export { OrderReconciler } from './reconciler.mjs';
export { transition, applyBrokerSnapshot } from './transitions.mjs';
export { InMemoryOmsStore, PgOmsStore } from './store.mjs';
