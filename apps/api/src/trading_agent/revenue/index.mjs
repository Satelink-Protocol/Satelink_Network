// Shadow revenue engine (Stage 20, option 2). See README.md. Flag: REVENUE_ENGINE (default OFF).
// No ledger writes, no schema change: this module imports nothing from the Financial-OS ledger.
export const DOMAIN = 'revenue';
export const FLAGS = Object.freeze(['REVENUE_ENGINE']);
export { Book, Stream, AccountType, ACCOUNT_TEMPLATES, accountId, chartOfAccounts, accountType } from './accounts.mjs';
export { RevenueError, EVENT_STREAM, COST_EVENTS, assertBalanced, expectedPosting, costPosting, settlementPosting, refundPosting } from './posting_rules.mjs';
export { ShadowRevenueEngine } from './engine.mjs';
export { evidenceFromVerification, SOURCE_EVENT_TYPE } from './evidence.mjs';
