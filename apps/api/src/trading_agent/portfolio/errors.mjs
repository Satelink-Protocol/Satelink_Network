// Portfolio errors (Stage 18).
export const PortfolioErrorCode = Object.freeze({
  CONFIG: 'CONFIG',
  INVALID: 'INVALID',
  NOT_FOUND: 'NOT_FOUND', // also returned for another tenant's data (no existence leak)
});

export class PortfolioError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'PortfolioError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
