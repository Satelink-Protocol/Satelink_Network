// Audit / trace errors (Stage 19).
export const AuditErrorCode = Object.freeze({ CONFIG: 'CONFIG', INVALID: 'INVALID', NOT_FOUND: 'NOT_FOUND' });
export class AuditError extends Error {
  constructor(code, message) { super(message); this.name = 'AuditError'; this.code = code; }
}
