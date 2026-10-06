// Billing errors (Stage 27). Codes map to HTTP through the Stage 24 API error table.
export class BillingError extends Error {
  constructor(code, message) { super(message ?? code); this.name = 'BillingError'; this.code = code; }
}
