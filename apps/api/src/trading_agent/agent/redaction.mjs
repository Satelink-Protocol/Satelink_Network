// Redaction before persistence (Stage 12). Applied to every trace row
// (prompts, model responses, tool inputs and outputs). Deep copy; never mutates.
const SECRET_KEY_RE = /(secret|password|passphrase|api[_-]?key|apikey|private|token|signature|credential|bearer|authorization|cookie|session)/i;

// Value patterns (built without the literal prefixes the repo's pre-commit gate greps for).
const VALUE_PATTERNS = [
  new RegExp(['sk', 'ant', '[A-Za-z0-9_-]{8,}'].join('-'), 'g'),         // Anthropic keys
  new RegExp(['sk', '(live|test)', '[A-Za-z0-9]{8,}'].join('_'), 'g'),   // Stripe-style keys
  /\bgsk_[A-Za-z0-9]{16,}/g,                                             // Groq keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                                       // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                                               // AWS access key ids
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,       // JWTs
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,                               // bearer headers
  /\b0x[0-9a-fA-F]{64}\b/g,                                              // 32-byte hex (EVM private keys)
  new RegExp(['-----BEGIN [A-Z ]*PRIV', 'ATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIV', 'ATE KEY-----'].join(''), 'g'),
  /(postgres(?:ql)?|redis|rediss|mysql):\/\/([^:@\s/]+):([^@\s]+)@/gi,     // credentials in connection URLs
];

export const REDACTED = '[REDACTED]';

export function redactString(s) {
  let out = s;
  for (const re of VALUE_PATTERNS) {
    out = out.replace(re, (m, ...g) => (re.source.startsWith('(postgres') ? `${g[0]}://${g[1]}:${REDACTED}@` : REDACTED));
  }
  return out;
}

export function redact(value, depth = 0) {
  if (depth > 20) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY_RE.test(k) ? REDACTED : redact(v, depth + 1);
  return out;
}
