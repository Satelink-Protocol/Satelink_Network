// Backtest / paper simulation errors (Stage 14).
export const SimErrorCode = Object.freeze({
  CONFIG: 'CONFIG',               // invalid simulation parameters or wiring
  INPUT_INVALID: 'INPUT_INVALID', // malformed / out-of-order candle
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DATA_INVALID: 'DATA_INVALID',   // historical data unusable (empty, wrong instrument, misaligned)
});

export class SimError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SimError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
