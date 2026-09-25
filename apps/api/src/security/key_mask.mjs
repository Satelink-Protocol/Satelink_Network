// API keys are secrets. Anything that is not the identifier column itself
// (api_credits.api_key and the columns that reference it) must carry one of:
//   keyHint(key) — display format "sk_free_…9f3a" (prefix + last 4), for logs/UI
//   keyRef(key)  — non-reversible SHA-256 reference, for ids that must correlate
// never the key. redactKeys() scrubs free text. See docs/incidents/TI_KEY_LOGGING.md.
import crypto from 'node:crypto';

export const KEY_PATTERN = /sk_[a-z]+_[0-9a-f]{16,}/g;

export function keyHint(key) {
  const s = String(key ?? '');
  if (!s) return '';
  const prefix = s.startsWith('sk_') ? s.slice(0, s.indexOf('_', 3) + 1) : s.slice(0, 3);
  return `${prefix}…${s.slice(-4)}`;
}

export function keyRef(key) {
  return 'kref_' + crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 16);
}

export function redactKeys(text) {
  return String(text ?? '').replace(KEY_PATTERN, (k) => keyHint(k));
}
