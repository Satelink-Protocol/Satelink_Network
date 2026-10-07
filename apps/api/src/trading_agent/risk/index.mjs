// Trading agent — risk subdomain. Stage 15: deterministic pre-trade risk engine. See ./README.md.
// Not mounted; no public API. STATUS stays 'skeleton' (= not wired at runtime).
export const DOMAIN = "risk";
export const TABLES = Object.freeze(["risk_policies"]);
export const FLAGS = Object.freeze(["TRADING_AGENT"]);
export const STATUS = "skeleton";

export { RiskError, RiskErrorCode } from './errors.mjs';
export { CHECKS, CHECKS_VERSION, ORDER_INTENT_SCHEMA, PASS, referencePrice, notionalMinor, reducesExposure, MODE_B_CAPS, isModeB } from './checks.mjs';
export { evaluateChecks, Decision } from './evaluate.mjs';
export { RiskEngine, RISK_ENGINE_VERSION } from './engine.mjs';
export { KILL_SWITCH_SCOPES, KillSwitchSource, engagedSwitches, activeKillSwitchesFor, assertKillSwitchPermission } from './kill_switch.mjs';
export { KillSwitchService } from './kill_switch_service.mjs';
export { POLICY_SCHEMA, HARD_CAPS, definePolicy, capViolations, RiskPolicyService } from './policy.mjs';
export { InMemoryRiskStore, PgRiskStore } from './store.mjs';
