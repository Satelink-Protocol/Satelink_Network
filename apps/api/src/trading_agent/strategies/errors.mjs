// Strategy DSL errors (Stage 13). Every rejection carries a stable code.
export const StrategyErrorCode = Object.freeze({
  SCHEMA_INVALID: 'SCHEMA_INVALID',           // document fails the DSL schema
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION', // unknown "dsl" version tag
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',           // size / depth / node-count bound
  SEMANTIC_INVALID: 'SEMANTIC_INVALID',       // valid shape, meaningless content (e.g. unknown indicator ref)
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',   // not an edge of the lifecycle graph
  GUARD_FAILED: 'GUARD_FAILED',               // legal edge, guard not satisfied
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',                       // concurrent transition / stale expected state
  CONFIG: 'CONFIG',
  INPUT_INVALID: 'INPUT_INVALID',             // evaluator input (candles / position) malformed
});

export class StrategyError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'StrategyError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
