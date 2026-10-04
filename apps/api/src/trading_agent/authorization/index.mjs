// Trading agent — authorization (mandates) subdomain. Stage 16. See ./README.md.
// Not mounted; no public API. The Stage 09 `mandates/` skeleton is untouched; this
// module owns the mandate lifecycle (table: mandates, 021 + 026).
export const DOMAIN = 'authorization';
export const TABLES = Object.freeze(['mandates']);
export const FLAGS = Object.freeze(['TRADING_AGENT', 'AUTONOMOUS_MODE']);
export const STATUS = 'skeleton';

export { MandateError, MandateErrorCode } from './errors.mjs';
export { MANDATE_TERMS_TAG, MANDATE_TERMS_SCHEMA, MandateMode, MODE_TO_021, DRAFT_FIELDS, defineTerms, hashTerms } from './terms.mjs';
export { signingChallenge, signMandate, verifyMandateSignature, stepUpFingerprint, SIGNATURE_PREFIX } from './signing.mjs';
export { StepUpMethod, createBetterAuthTotpVerifier } from './step_up.mjs';
export { MandateService } from './service.mjs';
export { InMemoryMandateStore, PgMandateStore } from './store.mjs';
