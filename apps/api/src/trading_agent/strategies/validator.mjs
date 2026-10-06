// Dependency-free validator for the JSON Schema subset used by the strategy DSL (Stage 13).
//
// apps/api declares no schema library (zod lives only in apps/web and packages/content;
// ajv is transitive), and its convention is hand-written schema modules, so this follows
// the same pattern as trading_agent/agent/schema.mjs. Differences that matter here:
//   * an object schema without `additionalProperties` is treated as `false` (strict);
//   * `integer` means a safe integer; JS non-integers are never accepted;
//   * `x-decimal` bounds decimal strings exactly (bigint compare, no floats);
//   * an unknown schema keyword is a CONFIG error, never silently ignored.
import { StrategyError } from './errors.mjs';

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'default', '$defs']);
const KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'propertyNames', 'minProperties', 'maxProperties',
  'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'oneOf', '$ref', 'x-decimal',
]);
const TYPES = new Set(['object', 'array', 'string', 'integer', 'boolean', 'null']);
const MAX_ERRORS = 20;

/** Throws CONFIG if the schema uses anything this validator does not implement. */
export function assertSupportedSchema(schema, root = schema, at = '#') {
  if (typeof schema === 'boolean') return;
  if (!isPlainObject(schema)) throw new StrategyError('CONFIG', `schema at ${at} is not an object`);
  for (const k of Object.keys(schema)) {
    if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k)) throw new StrategyError('CONFIG', `unsupported schema keyword "${k}" at ${at}`);
  }
  if (schema.type !== undefined && !TYPES.has(schema.type)) throw new StrategyError('CONFIG', `unsupported type "${schema.type}" at ${at}`);
  if (schema.$ref !== undefined) resolveRef(root, schema.$ref);
  for (const [k, sub] of Object.entries(schema.properties ?? {})) assertSupportedSchema(sub, root, `${at}/properties/${k}`);
  for (const [k, sub] of Object.entries(schema.$defs ?? {})) assertSupportedSchema(sub, root, `${at}/$defs/${k}`);
  for (const [i, sub] of (schema.oneOf ?? []).entries()) assertSupportedSchema(sub, root, `${at}/oneOf/${i}`);
  for (const k of ['items', 'additionalProperties', 'propertyNames']) {
    if (schema[k] !== undefined) assertSupportedSchema(schema[k], root, `${at}/${k}`);
  }
  if (schema['x-decimal']) {
    const d = schema['x-decimal'];
    for (const k of Object.keys(d)) if (!['min', 'max', 'exclusiveMin', 'exclusiveMax', 'maxScale'].includes(k)) throw new StrategyError('CONFIG', `unsupported x-decimal key "${k}" at ${at}`);
  }
}

/** Validate `value` against `schema`. Returns { ok, errors: [{ path, message }] }; never throws for bad input. */
export function validateAgainst(schema, value, root = schema) {
  const errors = [];
  check(schema, value, '$', root, errors);
  return { ok: errors.length === 0, errors: errors.slice(0, MAX_ERRORS) };
}

function check(schema, v, path, root, errors) {
  if (errors.length >= MAX_ERRORS) return;
  if (schema === true) return;
  if (schema === false) { errors.push({ path, message: 'no value allowed here' }); return; }
  if (schema.$ref) { check(resolveRef(root, schema.$ref), v, path, root, errors); return; }

  if (schema.oneOf) {
    const results = schema.oneOf.map((s) => { const e = []; check(s, v, path, root, e); return e; });
    const matches = results.filter((e) => e.length === 0).length;
    if (matches === 1) return;
    if (matches > 1) { errors.push({ path, message: `matches ${matches} alternatives, expected exactly one` }); return; }
    // Report the closest alternative's errors so messages stay specific.
    const best = results.reduce((a, b) => (b.length < a.length ? b : a));
    errors.push(...best.slice(0, MAX_ERRORS - errors.length));
    return;
  }

  if (schema.const !== undefined && v !== schema.const) errors.push({ path, message: `must be ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.includes(v)) errors.push({ path, message: `must be one of ${schema.enum.join(', ')}` });

  const type = schema.type ?? inferType(schema);
  if (type && !hasType(v, type)) { errors.push({ path, message: `expected ${type}, got ${describe(v)}` }); return; }

  if (typeof v === 'string') {
    const len = [...v].length;
    if (schema.minLength !== undefined && len < schema.minLength) errors.push({ path, message: `shorter than ${schema.minLength}` });
    if (schema.maxLength !== undefined && len > schema.maxLength) errors.push({ path, message: `longer than ${schema.maxLength}` });
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(v)) errors.push({ path, message: `does not match ${schema.pattern}` });
    else if (schema['x-decimal']) checkDecimal(schema['x-decimal'], v, path, errors);
  }
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum) errors.push({ path, message: `below minimum ${schema.minimum}` });
    if (schema.maximum !== undefined && v > schema.maximum) errors.push({ path, message: `above maximum ${schema.maximum}` });
  }
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) errors.push({ path, message: `fewer than ${schema.minItems} items` });
    if (schema.maxItems !== undefined && v.length > schema.maxItems) { errors.push({ path, message: `more than ${schema.maxItems} items` }); return; }
    if (schema.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) errors.push({ path, message: 'items must be unique' });
    if (schema.items !== undefined) v.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, root, errors));
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) errors.push({ path, message: `fewer than ${schema.minProperties} properties` });
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) { errors.push({ path, message: `more than ${schema.maxProperties} properties` }); return; }
    for (const r of schema.required ?? []) if (!Object.hasOwn(v, r)) errors.push({ path, message: `missing required property "${r}"` });
    const props = schema.properties ?? {};
    const extra = schema.additionalProperties ?? false;
    for (const k of keys) {
      const p = `${path}.${k}`;
      if (schema.propertyNames) check(schema.propertyNames, k, `${p} (name)`, root, errors);
      if (Object.hasOwn(props, k)) check(props[k], v[k], p, root, errors);
      else if (extra === false) errors.push({ path: p, message: 'unknown field' });
      else check(extra, v[k], p, root, errors);
    }
  }
}

function checkDecimal(spec, v, path, errors) {
  const scale = (v.split('.')[1] ?? '').length;
  if (spec.maxScale !== undefined && scale > spec.maxScale) { errors.push({ path, message: `more than ${spec.maxScale} decimal places` }); return; }
  if (spec.min !== undefined) {
    const c = compareDecimal(v, spec.min);
    if (c < 0 || (spec.exclusiveMin && c === 0)) errors.push({ path, message: `must be ${spec.exclusiveMin ? '>' : '>='} ${spec.min}` });
  }
  if (spec.max !== undefined) {
    const c = compareDecimal(v, spec.max);
    if (c > 0 || (spec.exclusiveMax && c === 0)) errors.push({ path, message: `must be ${spec.exclusiveMax ? '<' : '<='} ${spec.max}` });
  }
}

/** Exact comparison of two canonical-shape decimal strings. */
export function compareDecimal(a, b) {
  const scale = Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length);
  const units = (s) => {
    const neg = s.startsWith('-');
    const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
    const u = BigInt(i + f.padEnd(scale, '0'));
    return neg ? -u : u;
  };
  const x = units(a);
  const y = units(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

function resolveRef(root, ref) {
  const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!m || !root.$defs || !Object.hasOwn(root.$defs, m[1])) throw new StrategyError('CONFIG', `unresolvable $ref ${ref}`);
  return root.$defs[m[1]];
}

function inferType(schema) {
  if (schema.properties || schema.required || schema.additionalProperties !== undefined || schema.propertyNames) return 'object';
  return undefined;
}

function hasType(v, type) {
  switch (type) {
    case 'object': return isPlainObject(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'integer': return Number.isSafeInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return false;
  }
}

export function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'out-of-range integer' : 'non-integer number';
  return typeof v;
}

/**
 * Structural pre-check before schema validation: bounded depth and node count,
 * JSON-only values, no prototype-polluting keys. Iterative, so hostile depth or
 * cycles cannot overflow the stack.
 */
export function assertJsonShape(value, { maxDepth, maxNodes = 4096 }) {
  const stack = [[value, 1]];
  let nodes = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (++nodes > maxNodes) throw new StrategyError('LIMIT_EXCEEDED', `document has more than ${maxNodes} nodes`);
    if (depth > maxDepth) throw new StrategyError('LIMIT_EXCEEDED', `document nesting exceeds ${maxDepth}`);
    if (v === null || typeof v === 'string' || typeof v === 'boolean') continue;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new StrategyError('SCHEMA_INVALID', 'non-finite number');
      continue;
    }
    if (Array.isArray(v)) { for (const x of v) stack.push([x, depth + 1]); continue; }
    if (isPlainObject(v)) {
      for (const k of Object.keys(v)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new StrategyError('SCHEMA_INVALID', `forbidden key "${k}"`);
        stack.push([v[k], depth + 1]);
      }
      continue;
    }
    throw new StrategyError('SCHEMA_INVALID', `non-JSON value of type ${typeof v}`);
  }
}
