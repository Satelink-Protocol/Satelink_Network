// Security-layer errors (Stage 28). `code` is stable and safe to log; messages never contain key material.
export class SecurityError extends Error {
  constructor(code, message) { super(message); this.name = 'SecurityError'; this.code = code; }
}
