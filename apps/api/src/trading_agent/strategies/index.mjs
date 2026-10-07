// Trading agent — strategies subdomain. Stage 13: strategy DSL v1.0, validator,
// canonical hash, pure evaluator and guarded version lifecycle. See ./README.md.
// Not mounted; no public API. STATUS stays 'skeleton' (= not wired at runtime),
// as for the Stage 10–12 subdomains.
export const DOMAIN = "strategies";
export const TABLES = Object.freeze(["strategies","strategy_versions"]);
export const FLAGS = Object.freeze(["TRADING_AGENT"]);
export const STATUS = "skeleton";

export { StrategyError, StrategyErrorCode } from './errors.mjs';
export { DSL_V1_TAG, DSL_V1_SCHEMA, DSL_V1_LIMITS } from './dsl_schema_v1.mjs';
export { parseStrategyDsl, hashDefinition, DSL_VERSIONS, SUPPORTED_DSL_VERSIONS } from './dsl.mjs';
export { canonicalJson, contentHash } from './canonical.mjs';
export { compileStrategy } from './compiler.mjs';
export { LifecycleState, TRANSITIONS, DEPLOYED_STATES, LIFECYCLE_POLICY, checkTransition, isLegalTransition, statusProjection } from './lifecycle.mjs';
export { StrategyService, InMemoryStrategyStore, PgStrategyStore } from './service.mjs';
