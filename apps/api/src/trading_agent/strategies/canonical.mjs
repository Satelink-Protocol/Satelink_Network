// Canonical form and content hash for strategy definitions (Stage 13).
//
// normalize(): schema-driven. Applies `default`s, rewrites x-decimal strings to
//   canonical form ("1.50" → "1.5", "-0" → "0") and NFC-normalises every string,
//   so documents that mean the same thing serialise identically.
// canonicalJson(): RFC 8785 (JCS) for the value space the DSL allows (plain
//   objects, arrays, strings, safe integers, booleans, null): keys sorted by
//   UTF-16 code units, no whitespace, ECMAScript string escaping.
// contentHash(): "sha256:" + hex SHA-256 of the canonical UTF-8 bytes.
import { createHash } from 'node:crypto';
import { StrategyError } from './errors.mjs';
import { validateAgainst, isPlainObject } from './validator.mjs';

export function normalize(schema, value, root = schema) {
  if (schema === true || schema === false || schema === undefined) return clone(value);
  if (schema.$ref) return normalize(root.$defs[schema.$ref.slice('#/$defs/'.length)], value, root);
  if (schema.oneOf) {
    const branch = schema.oneOf.find((s) => validateAgainst(s, value, root).ok);
    if (!branch) throw new StrategyError('SCHEMA_INVALID', 'normalize: value matches no alternative');
    return normalize(branch, value, root);
  }
  if (typeof value === 'string') {
    const s = value.normalize('NFC');
    return schema['x-decimal'] ? canonicalDecimal(s) : s;
  }
  if (Array.isArray(value)) return value.map((v) => normalize(schema.items, v, root));
  if (isPlainObject(value)) {
    const out = {};
    const props = schema.properties ?? {};
    for (const [k, sub] of Object.entries(props)) {
      if (!Object.hasOwn(value, k) && sub.default !== undefined) out[k] = normalize(sub, clone(sub.default), root);
    }
    for (const k of Object.keys(value)) {
      const sub = Object.hasOwn(props, k) ? props[k] : schema.additionalProperties;
      out[k.normalize('NFC')] = normalize(sub, value[k], root);
    }
    return out;
  }
  return value;
}

/** "001.2300" is never produced (the pattern forbids it); strips trailing fractional zeros and "-0". */
export function canonicalDecimal(s) {
  let [i, f = ''] = s.split('.');
  f = f.replace(/0+$/, '');
  let out = f ? `${i}.${f}` : i;
  if (/^-0(\.0*)?$/.test(out)) out = '0';
  return out;
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new StrategyError('SCHEMA_INVALID', 'canonical form allows safe integers only');
    return JSON.stringify(value); // -0 → "0"
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort(); // default sort = UTF-16 code-unit order, as JCS requires
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  throw new StrategyError('SCHEMA_INVALID', `cannot canonicalise ${typeof value}`);
}

export function contentHash(canonical) {
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

export const HASH_RE = /^sha256:[0-9a-f]{64}$/;

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
