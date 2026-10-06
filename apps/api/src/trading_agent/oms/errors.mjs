// OMS errors (Stage 17). Order acceptance never throws for a refusal (it returns
// { accepted: false, reason }); these are for wiring and illegal state changes.
export const OmsErrorCode = Object.freeze({
  CONFIG: 'CONFIG',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  CONFLICT: 'CONFLICT',          // compare-and-set lost (another worker moved the order)
  NOT_FOUND: 'NOT_FOUND',
});

export class OmsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'OmsError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** Thrown by test fault injection to simulate a process crash at a named point. */
export class SimulatedCrash extends Error {
  constructor(point) { super(`simulated crash at ${point}`); this.name = 'SimulatedCrash'; this.point = point; }
}
