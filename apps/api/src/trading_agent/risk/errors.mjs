// Risk engine errors (Stage 15). A decision never throws to its caller (it REJECTs);
// these are for policy / kill-switch administration and wiring.
export const RiskErrorCode = Object.freeze({
  CONFIG: 'CONFIG',
  FORBIDDEN: 'FORBIDDEN',       // actor may not do this (agents never may)
  CAP_EXCEEDED: 'CAP_EXCEEDED', // limit above plan cap (users) or hard cap (admins)
  INVALID: 'INVALID',           // malformed policy / kill-switch request
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
});

export class RiskError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'RiskError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
