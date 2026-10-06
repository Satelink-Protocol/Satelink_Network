// Agent-layer errors (Stage 12).
export class AgentError extends Error {
  /**
   * @param {string} code  UNKNOWN_TOOL | FORBIDDEN_TOOL | SCHEMA_INVALID | TOOL_FAILED | PROVIDER_ERROR |
   *                       ROUTE_NOT_FOUND | CONFIG | BOUNDARY_VIOLATION | MAX_STEPS
   * @param {string} [message]
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'AgentError';
    this.code = code;
    this.details = details;
  }
}

/** Provider failures carry retryability so the router can decide on fallback. */
export class ProviderError extends AgentError {
  constructor(message, { retryable = false, status = null, provider = null } = {}) {
    super('PROVIDER_ERROR', message, { retryable, status, provider });
    this.retryable = retryable;
    this.status = status;
    this.provider = provider;
  }
}
