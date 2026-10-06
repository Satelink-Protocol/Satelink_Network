// Strategy DSL entry point (Stage 13): parse → validate → normalise → hash.
//
// parseStrategyDsl(input) accepts a JSON string or a plain object and returns a
// frozen { dslVersion, definition, canonical, hash }. `definition` is the
// normalised document (defaults applied); `canonical` is its JCS serialisation
// and `hash` its sha256. That triple is what strategy_versions stores
// (definition, definition_hash), so the stored bytes are exactly what was hashed.
import { StrategyError } from './errors.mjs';
import { DSL_V1_TAG, DSL_V1_SCHEMA, DSL_V1_LIMITS } from './dsl_schema_v1.mjs';
import { assertSupportedSchema, validateAgainst, assertJsonShape, isPlainObject } from './validator.mjs';
import { normalize, canonicalJson, contentHash, deepFreeze } from './canonical.mjs';

/** Every supported DSL version. A new version is a new entry; v1.0 is never edited in place. */
export const DSL_VERSIONS = Object.freeze({
  [DSL_V1_TAG]: Object.freeze({ schema: DSL_V1_SCHEMA, limits: DSL_V1_LIMITS, semantic: semanticV1 }),
});
for (const v of Object.values(DSL_VERSIONS)) assertSupportedSchema(v.schema);

export const SUPPORTED_DSL_VERSIONS = Object.freeze(Object.keys(DSL_VERSIONS));

export function parseStrategyDsl(input) {
  let doc = input;
  if (typeof input === 'string') {
    // Upper bound before parsing: a UTF-8 byte is at least 1 char, a char at most 3 bytes.
    if (input.length > DSL_V1_LIMITS.maxBytes * 3) throw new StrategyError('LIMIT_EXCEEDED', 'document too large');
    try { doc = JSON.parse(input); } catch { throw new StrategyError('SCHEMA_INVALID', 'not valid JSON'); }
  }
  if (!isPlainObject(doc)) throw new StrategyError('SCHEMA_INVALID', 'strategy must be a JSON object');
  // Own-property lookup only: "__proto__" / "constructor" must not resolve to Object.prototype members.
  const version = typeof doc.dsl === 'string' && Object.hasOwn(DSL_VERSIONS, doc.dsl) ? DSL_VERSIONS[doc.dsl] : null;
  if (!version) {
    throw new StrategyError('UNSUPPORTED_VERSION', `unsupported dsl version ${JSON.stringify(doc.dsl ?? null)}; supported: ${SUPPORTED_DSL_VERSIONS.join(', ')}`);
  }
  const { schema, limits, semantic } = version;
  assertJsonShape(doc, { maxDepth: limits.maxDepth });

  const first = validateAgainst(schema, doc);
  if (!first.ok) throw new StrategyError('SCHEMA_INVALID', summarize(first.errors), { errors: first.errors });
  const definition = normalize(schema, doc);
  const second = validateAgainst(schema, definition); // NFC/default rewriting must not break validity
  if (!second.ok) throw new StrategyError('SCHEMA_INVALID', summarize(second.errors), { errors: second.errors });
  semantic(definition, limits);

  const canonical = canonicalJson(definition);
  const bytes = Buffer.byteLength(canonical, 'utf8');
  if (bytes > limits.maxBytes) throw new StrategyError('LIMIT_EXCEEDED', `canonical document is ${bytes} bytes (max ${limits.maxBytes})`);
  return deepFreeze({ dslVersion: doc.dsl, definition: deepFreeze(definition), canonical, hash: contentHash(canonical) });
}

/** Hash of an already-normalised definition (e.g. read back from the database). */
export function hashDefinition(definition) {
  return contentHash(canonicalJson(definition));
}

function summarize(errors) {
  const shown = errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ');
  return errors.length > 3 ? `${shown}; …and ${errors.length - 3} more` : shown;
}

/** Checks the schema cannot express. */
function semanticV1(def, limits) {
  const fail = (msg) => { throw new StrategyError('SEMANTIC_INVALID', msg); };
  if (def.name.trim().length === 0) fail('name must not be blank');
  const indicators = def.indicators;
  let nodes = 0;

  const operand = (o, where) => {
    nodes += 1;
    if (o.ind !== undefined && !Object.hasOwn(indicators, o.ind)) fail(`${where}: unknown indicator "${o.ind}"`);
  };
  const pair = (node, where) => {
    operand(node.left, `${where}.left`);
    operand(node.right, `${where}.right`);
    if (node.left.const !== undefined && node.right.const !== undefined) fail(`${where}: compares two constants`);
    if (canonicalJson(node.left) === canonicalJson(node.right)) fail(`${where}: compares an operand with itself`);
  };
  const walk = (c, depth, where) => {
    nodes += 1;
    if (depth > limits.maxConditionDepth) throw new StrategyError('LIMIT_EXCEEDED', `${where}: condition nesting exceeds ${limits.maxConditionDepth}`);
    if (nodes > limits.maxConditionNodes) throw new StrategyError('LIMIT_EXCEEDED', `conditions exceed ${limits.maxConditionNodes} nodes`);
    if (c.all) c.all.forEach((x, i) => walk(x, depth + 1, `${where}.all[${i}]`));
    else if (c.any) c.any.forEach((x, i) => walk(x, depth + 1, `${where}.any[${i}]`));
    else if (c.not) walk(c.not, depth + 1, `${where}.not`);
    else if (c.cmp) pair(c.cmp, `${where}.cmp`);
    else if (c.cross) pair(c.cross, `${where}.cross`);
  };
  walk(def.entry, 1, 'entry');
  walk(def.exit, 1, 'exit');
  if (nodes > limits.maxConditionNodes) throw new StrategyError('LIMIT_EXCEEDED', `conditions exceed ${limits.maxConditionNodes} nodes`);
  if (def.execution.orderType === 'market' && def.execution.limitOffsetBps !== 0) fail('execution.limitOffsetBps applies to limit orders only');
}
