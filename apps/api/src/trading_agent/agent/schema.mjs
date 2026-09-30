// Minimal JSON-Schema subset validator (Stage 12). No dependency.
//
// Every structured output (model responses, tool inputs, tool outputs) is
// RE-VALIDATED here, even when a provider claims native structured output.
// Supported keywords: type, properties, required, additionalProperties (default
// false: unknown keys are rejected), enum, const, minLength, maxLength, pattern,
// minimum, maximum, items, minItems, maxItems. Anything else in a schema is a
// CONFIG error, so a schema can never silently mean less than it says.
import { AgentError } from './errors.mjs';

const KNOWN = new Set(['type', 'properties', 'required', 'additionalProperties', 'enum', 'const', 'minLength', 'maxLength',
  'pattern', 'minimum', 'maximum', 'items', 'minItems', 'maxItems', 'description']);
const TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array', 'null']);

/** Decimal string (no floats): reuse for prices/quantities in tool schemas. */
export const DECIMAL_STRING = Object.freeze({ type: 'string', pattern: '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$', maxLength: 40 });

export function assertSchema(schema, path = '$') {
  if (!schema || typeof schema !== 'object') throw new AgentError('CONFIG', `schema at ${path} must be an object`);
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new AgentError('CONFIG', `unsupported schema keyword "${k}" at ${path}`);
  const types = [].concat(schema.type ?? []);
  if (types.length === 0 && !schema.enum && !('const' in schema)) throw new AgentError('CONFIG', `schema at ${path} needs type, enum or const`);
  for (const t of types) if (!TYPES.has(t)) throw new AgentError('CONFIG', `unknown type ${t} at ${path}`);
  if (schema.properties) for (const [k, s] of Object.entries(schema.properties)) assertSchema(s, `${path}.${k}`);
  if (schema.items) assertSchema(schema.items, `${path}[]`);
  return schema;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** @returns {{ok:boolean, errors:string[]}} */
export function validate(schema, value, path = '$', errors = []) {
  const push = (m) => errors.push(`${path}: ${m}`);
  if ('const' in schema && value !== schema.const) push(`must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) push(`must be one of ${JSON.stringify(schema.enum)}`);
  if (schema.type) {
    const allowed = [].concat(schema.type);
    const t = typeOf(value);
    const ok = allowed.includes(t) || (t === 'integer' && allowed.includes('number'));
    if (!ok) { push(`expected ${allowed.join('|')}, got ${t}`); return { ok: false, errors }; }
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) push(`shorter than ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) push(`longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) push(`does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) push('must be finite');
    if (schema.minimum != null && value < schema.minimum) push(`below ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) push(`above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) push(`fewer than ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) push(`more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => validate(schema.items, v, `${path}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties || {};
    for (const r of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, r)) push(`missing required "${r}"`);
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validate(props[k], v, `${path}.${k}`, errors);
      else if (schema.additionalProperties !== true) push(`unexpected property "${k}"`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assertValid(schema, value, what = 'value') {
  const r = validate(schema, value);
  if (!r.ok) throw new AgentError('SCHEMA_INVALID', `${what} failed schema validation: ${r.errors.slice(0, 5).join('; ')}`, { errors: r.errors });
  return value;
}
