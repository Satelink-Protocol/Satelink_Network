// Mandate authorization errors (Stage 16). Every refusal carries a stable code.
export const MandateErrorCode = Object.freeze({
  CONFIG: 'CONFIG',
  INVALID: 'INVALID',                   // malformed draft / request
  FORBIDDEN: 'FORBIDDEN',               // actor may not do this (agents never sign or propose)
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',                 // wrong state / concurrent change
  LOCKED_MODE: 'LOCKED_MODE',           // mode C while AUTONOMOUS_MODE is locked
  HASH_MISMATCH: 'HASH_MISMATCH',       // signed hash ≠ stored terms, or stored row ≠ its terms
  REPLAY: 'REPLAY',                     // nonce reused / already signed / step-up code reused
  CHALLENGE_EXPIRED: 'CHALLENGE_EXPIRED',
  ATTEMPTS_EXCEEDED: 'ATTEMPTS_EXCEEDED',
  STEP_UP_UNAVAILABLE: 'STEP_UP_UNAVAILABLE', // user has no enrolled step-up factor
  STEP_UP_FAILED: 'STEP_UP_FAILED',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  NOT_ACTIVE: 'NOT_ACTIVE',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  NOT_YET_VALID: 'NOT_YET_VALID',
});

export class MandateError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MandateError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
