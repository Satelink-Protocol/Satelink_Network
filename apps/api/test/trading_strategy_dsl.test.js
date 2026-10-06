import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseStrategyDsl, hashDefinition, compileStrategy, canonicalJson, StrategyError, StrategyErrorCode,
  DSL_V1_SCHEMA, LifecycleState as S, TRANSITIONS, checkTransition, isLegalTransition, statusProjection,
  StrategyService, InMemoryStrategyStore,
} from '../src/trading_agent/strategies/index.mjs';
import { validateAgainst, assertSupportedSchema } from '../src/trading_agent/strategies/validator.mjs';
import { tradingFlagEnvName } from '../src/trading_agent/flags.mjs';

// Stage 13 — strategy DSL v1.0. Pure: no network, no DB, no process.env.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STRATEGIES_DIR = path.resolve(HERE, '../src/trading_agent/strategies');
const INDEX_URL = new URL('../src/trading_agent/strategies/index.mjs', import.meta.url).href;
const CODES = new Set(Object.values(StrategyErrorCode));

const GOLDEN = () => ({
  dsl: 'satelink.strategy/1.0',
  name: 'BTC trend (SMA 10/30)',
  description: 'Golden fixture for Stage 13 hash stability.',
  universe: { venue: 'binance', instruments: ['BTC-USDT', 'ETH-USDT'] },
  timeframe: '1h',
  indicators: { fast: { type: 'sma', period: 10 }, slow: { type: 'ema', period: 30, source: 'close' }, rsi14: { type: 'rsi', period: 14 }, atr14: { type: 'atr', period: 14 } },
  entry: { all: [{ cross: { dir: 'above', left: { ind: 'fast' }, right: { ind: 'slow' } } }, { cmp: { op: 'lt', left: { ind: 'rsi14' }, right: { const: '70' } } }] },
  exit: { any: [{ cross: { dir: 'below', left: { ind: 'fast' }, right: { ind: 'slow' } } }, { cmp: { op: 'gt', left: { ind: 'rsi14' }, right: { const: '80' } } }] },
  position: { side: 'long', sizing: { mode: 'fixed_notional', notional: '250.00', currency: 'USDT' } },
  risk: { stopLossPct: '2.5', takeProfitPct: '6', maxHoldingBars: 240 },
  execution: { orderType: 'limit', limitOffsetBps: 5, cooldownBars: 3 },
});
// Pinned: if this changes, every stored definition_hash changes. That needs a new DSL version, not an edit.
const GOLDEN_HASH = 'sha256:24a3a6ef476919421b90c4b040fa4ef030a7716ef8088145a674898c6db10f21';

const MINIMAL = () => ({
  dsl: 'satelink.strategy/1.0', name: 'SMA cross', universe: { venue: 'binance', instruments: ['BTC-USDT'] }, timeframe: '1h',
  indicators: { fast: { type: 'sma', period: 2 }, slow: { type: 'sma', period: 4 } },
  entry: { cross: { dir: 'above', left: { ind: 'fast' }, right: { ind: 'slow' } } },
  exit: { cross: { dir: 'below', left: { ind: 'fast' }, right: { ind: 'slow' } } },
  position: { side: 'long', sizing: { mode: 'fixed_quantity', quantity: '0.01' } },
  risk: { stopLossPct: '2' },
});

function codeOf(fn) {
  try { fn(); return null; } catch (e) {
    if (!(e instanceof StrategyError)) throw e; // anything else is a bug
    return e.code;
  }
}
function set(obj, pathArr, value) {
  const o = structuredClone(obj);
  let t = o;
  for (const k of pathArr.slice(0, -1)) t = t[k];
  if (value === undefined) delete t[pathArr.at(-1)]; else t[pathArr.at(-1)] = value;
  return o;
}

/** Deterministic PRNG (mulberry32) so fuzz failures reproduce. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('strategy DSL: schema', () => {
  it('the published schema only uses keywords the validator implements', () => {
    expect(() => assertSupportedSchema(DSL_V1_SCHEMA)).to.not.throw();
    expect(() => assertSupportedSchema({ type: 'object', anyOf: [] })).to.throw(StrategyError).with.property('code', 'CONFIG');
    expect(() => assertSupportedSchema({ type: 'number' })).to.throw(/unsupported type/);
  });

  it('an object schema without additionalProperties is strict by default', () => {
    const r = validateAgainst({ type: 'object', properties: { a: { type: 'string' } } }, { a: 'x', b: 1 });
    expect(r.ok).to.equal(false);
    expect(r.errors[0]).to.deep.equal({ path: '$.b', message: 'unknown field' });
  });

  it('accepts the golden and minimal documents and fills defaults', () => {
    const p = parseStrategyDsl(MINIMAL());
    expect(p.definition.description).to.equal('');
    expect(p.definition.execution).to.deep.equal({ orderType: 'market', limitOffsetBps: 0, cooldownBars: 0 });
    expect(p.definition.indicators.fast.source).to.equal('close');
    expect(p.definition.position.maxOpenPositions).to.equal(1);
    expect(Object.isFrozen(p.definition.indicators.fast)).to.equal(true);
    expect(parseStrategyDsl(GOLDEN()).hash).to.equal(GOLDEN_HASH);
  });

  it('rejects unknown fields at every level', () => {
    const paths = [[], ['universe'], ['indicators', 'fast'], ['entry', 'cross'], ['entry', 'cross', 'left'], ['position'], ['position', 'sizing'], ['risk'], ['execution']];
    const base = { ...MINIMAL(), execution: { orderType: 'market' } };
    for (const p of paths) {
      const doc = set(base, [...p, 'leverage'], 100);
      expect(codeOf(() => parseStrategyDsl(doc)), p.join('.') || 'root').to.equal('SCHEMA_INVALID');
    }
    expect(codeOf(() => parseStrategyDsl({ ...MINIMAL(), entry: { cross: { dir: 'above', left: { ind: 'fast' }, right: { ind: 'slow' } }, all: [] } }))).to.equal('SCHEMA_INVALID');
  });

  it('enforces bounded numeric ranges and decimal-string money', () => {
    const bad = [
      [['indicators', 'fast', 'period'], 1], [['indicators', 'fast', 'period'], 501], [['indicators', 'fast', 'period'], 2.5],
      [['indicators', 'fast', 'period'], '10'], [['indicators', 'fast', 'period'], Number.MAX_SAFE_INTEGER + 1],
      [['risk', 'stopLossPct'], '0'], [['risk', 'stopLossPct'], '50.0001'], [['risk', 'stopLossPct'], '2.12345'], [['risk', 'stopLossPct'], 2],
      [['risk', 'stopLossPct'], '1e1'], [['risk', 'stopLossPct'], '02'], [['risk', 'stopLossPct'], undefined],
      [['position', 'sizing', 'quantity'], '0'], [['position', 'sizing', 'quantity'], '-1'], [['position', 'sizing', 'quantity'], 0.01],
      [['position', 'sizing', 'quantity'], '1000000001'], [['position', 'sizing', 'quantity'], '0.0000000000001'],
      [['risk', 'maxHoldingBars'], 0], [['risk', 'maxHoldingBars'], 100_001],
      [['universe', 'venue'], 'kraken'], [['universe', 'instruments'], []], [['universe', 'instruments'], ['btc-usdt']],
      [['universe', 'instruments'], ['BTC-USDT', 'BTC-USDT']], [['universe', 'instruments'], Array.from({ length: 11 }, (_, i) => `C${i}X-USDT`)],
      [['timeframe'], '2h'], [['name'], ''], [['name'], 'x'.repeat(121)], [['position', 'side'], 'both'],
    ];
    for (const [p, v] of bad) expect(codeOf(() => parseStrategyDsl(set(MINIMAL(), p, v))), `${p.join('.')}=${JSON.stringify(v)}`).to.equal('SCHEMA_INVALID');
    expect(codeOf(() => parseStrategyDsl(set(MINIMAL(), ['risk', 'stopLossPct'], '50')))).to.equal(null);
  });

  it('rejects unsupported versions, non-objects and non-JSON values', () => {
    expect(codeOf(() => parseStrategyDsl(set(MINIMAL(), ['dsl'], 'satelink.strategy/2.0')))).to.equal('UNSUPPORTED_VERSION');
    expect(codeOf(() => parseStrategyDsl(set(MINIMAL(), ['dsl'], undefined)))).to.equal('UNSUPPORTED_VERSION');
    for (const tag of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 1]) { // regression: found by the fuzz test
      expect(codeOf(() => parseStrategyDsl(set(MINIMAL(), ['dsl'], tag))), String(tag)).to.equal('UNSUPPORTED_VERSION');
    }
    for (const v of [null, [], 'nope', 42, '{bad json']) expect(codeOf(() => parseStrategyDsl(v)), String(v)).to.be.oneOf(['SCHEMA_INVALID', 'UNSUPPORTED_VERSION']);
    expect(codeOf(() => parseStrategyDsl({ ...MINIMAL(), description: new Date(0) }))).to.equal('SCHEMA_INVALID');
    expect(codeOf(() => parseStrategyDsl({ ...MINIMAL(), name: undefined, description: () => 1 }))).to.equal('SCHEMA_INVALID');
    expect(codeOf(() => parseStrategyDsl(JSON.parse('{"dsl":"satelink.strategy/1.0","__proto__":{"x":1}}')))).to.equal('SCHEMA_INVALID');
    expect(codeOf(() => parseStrategyDsl({ ...MINIMAL(), risk: { stopLossPct: '2', maxHoldingBars: Infinity } }))).to.equal('SCHEMA_INVALID');
  });

  it('enforces structural limits (depth, nodes, size) without stack overflow', () => {
    let deep = { cmp: { op: 'gt', left: { ind: 'fast' }, right: { ind: 'slow' } } };
    for (let i = 0; i < 8; i += 1) deep = { not: deep };
    expect(codeOf(() => parseStrategyDsl({ ...MINIMAL(), entry: deep }))).to.equal('LIMIT_EXCEEDED');
    let hostile = {};
    for (let i = 0; i < 100_000; i += 1) hostile = { not: hostile };
    expect(codeOf(() => parseStrategyDsl({ ...MINIMAL(), entry: hostile }))).to.equal('LIMIT_EXCEEDED');
    const cyc = MINIMAL(); cyc.entry = { not: {} }; cyc.entry.not.not = cyc.entry;
    expect(codeOf(() => parseStrategyDsl(cyc))).to.equal('LIMIT_EXCEEDED');
    const leaf = { cmp: { op: 'gt', left: { ind: 'fast' }, right: { const: '1' } } };
    const wide = { all: Array.from({ length: 16 }, () => ({ all: [leaf, leaf] })) };
    expect(codeOf(() => parseStrategyDsl({ ...MINIMAL(), entry: wide }))).to.equal('LIMIT_EXCEEDED');
    expect(codeOf(() => parseStrategyDsl('x'.repeat(200_000)))).to.equal('LIMIT_EXCEEDED');
  });

  it('applies semantic checks the schema cannot express', () => {
    const cmp = (left, right) => ({ ...MINIMAL(), entry: { cmp: { op: 'gt', left, right } } });
    expect(codeOf(() => parseStrategyDsl(cmp({ ind: 'missing' }, { ind: 'slow' })))).to.equal('SEMANTIC_INVALID');
    expect(codeOf(() => parseStrategyDsl(cmp({ const: '1' }, { const: '2' })))).to.equal('SEMANTIC_INVALID');
    expect(codeOf(() => parseStrategyDsl(cmp({ ind: 'fast' }, { ind: 'fast' })))).to.equal('SEMANTIC_INVALID');
    expect(codeOf(() => parseStrategyDsl({ ...MINIMAL(), execution: { orderType: 'market', limitOffsetBps: 5 } }))).to.equal('SEMANTIC_INVALID');
    expect(codeOf(() => parseStrategyDsl({ ...MINIMAL(), name: '   ' }))).to.equal('SEMANTIC_INVALID');
  });
});

describe('strategy DSL: fuzz', () => {
  const randomValue = (r, depth = 0) => {
    const k = Math.floor(r() * (depth > 3 ? 6 : 8));
    switch (k) {
      case 0: return null;
      case 1: return r() < 0.5;
      case 2: return [0, -1, 1.5, 1e308, -0, 2 ** 53, 7][Math.floor(r() * 7)];
      case 3: return ['', 'x', '0', '1.50', '-0', 'BTC-USDT', 'satelink.strategy/1.0', '\u0000', 'é', 'sma', '__proto__'][Math.floor(r() * 11)];
      case 4: return '9'.repeat(Math.floor(r() * 40));
      case 5: return 'close';
      case 6: return Array.from({ length: Math.floor(r() * 4) }, () => randomValue(r, depth + 1));
      default: return Object.fromEntries(Array.from({ length: Math.floor(r() * 4) }, (_, i) => [['dsl', 'name', 'risk', 'entry', 'x', 'not', 'all', 'ind', 'const'][Math.floor(r() * 9)] + (i ? '' : ''), randomValue(r, depth + 1)]));
    }
  };
  const allPaths = (v, p = []) => (v && typeof v === 'object' ? [p, ...Object.keys(v).flatMap((k) => allPaths(v[k], [...p, Array.isArray(v) ? Number(k) : k]))] : [p]);

  it('random JSON values: only StrategyErrors with known codes, never a crash', () => {
    const r = rng(1301);
    for (let i = 0; i < 3000; i += 1) {
      const v = randomValue(r);
      const doc = r() < 0.5 && v && typeof v === 'object' && !Array.isArray(v) ? { ...v, dsl: 'satelink.strategy/1.0' } : v;
      const code = codeOf(() => parseStrategyDsl(doc));
      expect(code === null || CODES.has(code), `${code} for ${JSON.stringify(doc)}`).to.equal(true);
    }
  });

  it('mutated golden documents: rejected with a known code, or accepted and fully consistent', () => {
    const r = rng(1302);
    let accepted = 0;
    for (let i = 0; i < 2000; i += 1) {
      const base = GOLDEN();
      const paths = allPaths(base).filter((p) => p.length > 0);
      const p = paths[Math.floor(r() * paths.length)];
      const op = r();
      const doc = op < 0.3 ? set(base, p, undefined) : op < 0.8 ? set(base, p, randomValue(r)) : set(base, [...p.slice(0, -1), 'zz_unknown'], 1);
      let parsed;
      try { parsed = parseStrategyDsl(doc); } catch (e) {
        expect(e).to.be.instanceOf(StrategyError);
        expect(CODES.has(e.code), e.code).to.equal(true);
        continue;
      }
      accepted += 1;
      expect(validateAgainst(DSL_V1_SCHEMA, parsed.definition).ok).to.equal(true);
      expect(hashDefinition(parsed.definition)).to.equal(parsed.hash);
      expect(parseStrategyDsl(parsed.canonical).hash).to.equal(parsed.hash); // normalisation is idempotent
      expect(() => compileStrategy(parsed)).to.not.throw();
    }
    expect(accepted).to.be.greaterThan(0);
  });
});

describe('strategy DSL: canonical hash stability', () => {
  const shuffleKeys = (v, r) => {
    if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, r));
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
      return Object.fromEntries(keys.map((k) => [k, shuffleKeys(v[k], r)]));
    }
    return v;
  };

  it('identical DSL → identical hash across key orders, whitespace and JSON-string input', () => {
    const r = rng(1303);
    for (let i = 0; i < 200; i += 1) {
      const doc = shuffleKeys(GOLDEN(), r);
      expect(parseStrategyDsl(doc).hash).to.equal(GOLDEN_HASH);
      expect(parseStrategyDsl(JSON.stringify(doc, null, i % 5)).hash).to.equal(GOLDEN_HASH);
    }
  });

  it('identical DSL → identical hash across separate Node processes (golden vector)', () => {
    const script = `import(${JSON.stringify(INDEX_URL)}).then((m) => process.stdout.write(m.parseStrategyDsl(${JSON.stringify(JSON.stringify(GOLDEN()))}).hash));`;
    for (let i = 0; i < 2; i += 1) {
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { PATH: process.env.PATH } });
      expect(out).to.equal(GOLDEN_HASH);
    }
  });

  it('equivalent spellings hash the same; any semantic change hashes differently', () => {
    const same = [
      set(GOLDEN(), ['position', 'sizing', 'notional'], '250'),
      set(GOLDEN(), ['risk', 'takeProfitPct'], '6.000'),
      set(set(GOLDEN(), ['indicators', 'fast', 'source'], 'close'), ['position', 'maxOpenPositions'], 1),
      set(GOLDEN(), ['name'], 'BTC trend (SMA 10/30)'.normalize('NFD')),
    ];
    for (const d of same) expect(parseStrategyDsl(d).hash).to.equal(GOLDEN_HASH);
    const accented = (form) => parseStrategyDsl(set(GOLDEN(), ['name'], 'Stratégie'.normalize(form))).hash;
    expect(accented('NFD')).to.equal(accented('NFC'));
    const different = [
      set(GOLDEN(), ['indicators', 'fast', 'period'], 11), set(GOLDEN(), ['risk', 'stopLossPct'], '2.51'),
      set(GOLDEN(), ['universe', 'instruments'], ['ETH-USDT', 'BTC-USDT']), set(GOLDEN(), ['description'], 'changed'),
    ];
    const hashes = new Set([GOLDEN_HASH, ...different.map((d) => parseStrategyDsl(d).hash)]);
    expect(hashes.size).to.equal(different.length + 1);
  });

  it('canonical JSON is sorted, compact and JCS-escaped', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'é"\n'], A: {} })).to.equal('{"A":{},"a":[true,null,"é\\"\\n"],"b":1}');
    expect(canonicalJson(-0)).to.equal('0');
    expect(() => canonicalJson(1.5)).to.throw(StrategyError);
  });
});

describe('strategy DSL: compiled evaluator', () => {
  const candles = (closes, spread = '1') => closes.map((c, i) => {
    const h = (Number(c) + Number(spread)).toString();
    const l = (Number(c) - Number(spread)).toString();
    return { openTime: i * 3_600_000, open: c, high: h, low: l, close: c };
  });
  const indicatorsDoc = {
    ...MINIMAL(),
    indicators: { fast: { type: 'sma', period: 2 }, slow: { type: 'sma', period: 4 }, r: { type: 'rsi', period: 3 }, a: { type: 'atr', period: 3 }, e: { type: 'ema', period: 3 }, hi: { type: 'highest', period: 3, source: 'high' }, lo: { type: 'lowest', period: 3, source: 'low' } },
  };
  const SERIES = ['10', '10', '10', '10', '9', '9', '12'];

  it('computes indicators exactly (hand-checked values)', () => {
    const ev = compileStrategy(parseStrategyDsl(indicatorsDoc));
    const out = ev.evaluate({ candles: candles(SERIES) });
    expect(ev.warmupBars).to.equal(5);
    expect(out.values).to.deep.equal({
      a: '2.666666666666666667', e: '10.625', fast: '10.5', hi: '13', lo: '8', r: '87.096774193548387108', slow: '10',
    });
    expect([out.signal, out.reasons]).to.deep.equal(['enter', ['entry_rule']]);
  });

  it('is deterministic and side-effect free', () => {
    const ev = compileStrategy(parseStrategyDsl(indicatorsDoc));
    const input = { candles: candles(SERIES) };
    const before = JSON.stringify(input);
    expect(JSON.stringify(ev.evaluate(input))).to.equal(JSON.stringify(ev.evaluate(input)));
    expect(JSON.stringify(input)).to.equal(before);
    expect(Object.isFrozen(ev)).to.equal(true);
    for (const f of ['compiler.mjs', 'indicators.mjs', 'fixed.mjs', 'dsl.mjs', 'canonical.mjs', 'validator.mjs', 'dsl_schema_v1.mjs', 'lifecycle.mjs']) {
      const src = fs.readFileSync(path.join(STRATEGIES_DIR, f), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).to.not.match(/Date\.now|new Date|Math\.random|process\.env|fetch\(|setTimeout|from ['"](pg|ioredis|redis|node:fs|node:net|node:http|node:https|node:child_process)['"]/);
    }
  });

  it('warms up, then handles stop-loss > take-profit > max-holding > exit rule, for long and short', () => {
    const ev = compileStrategy(parseStrategyDsl({ ...MINIMAL(), risk: { stopLossPct: '2', takeProfitPct: '5', maxHoldingBars: 10 } }));
    expect(ev.evaluate({ candles: candles(SERIES.slice(0, 4)) })).to.deep.include({ ready: false, signal: 'hold' });
    const pos = (entryPrice, barsHeld = 1) => ({ side: 'long', entryPrice, barsHeld });
    expect(ev.evaluate({ candles: candles(SERIES), position: pos('13') }).reasons).to.deep.equal(['stop_loss']);
    expect(ev.evaluate({ candles: candles(SERIES, '0.01'), position: pos('11') }).reasons).to.deep.equal(['take_profit']);
    expect(ev.evaluate({ candles: candles(SERIES, '0.01'), position: pos('12', 10) }).reasons).to.deep.equal(['max_holding']);
    expect(ev.evaluate({ candles: candles(SERIES, '0.01'), position: pos('12', 1) })).to.deep.include({ signal: 'hold' });
    const down = candles(['10', '10', '10', '10', '11', '11', '8'], '0.01');
    expect(ev.evaluate({ candles: down, position: pos('8.1') }).reasons).to.deep.equal(['exit_rule']);
    const short = compileStrategy(parseStrategyDsl({ ...MINIMAL(), position: { side: 'short', sizing: { mode: 'fixed_quantity', quantity: '1' } } }));
    expect(short.evaluate({ candles: candles(SERIES), position: { side: 'short', entryPrice: '11', barsHeld: 1 } }).reasons).to.deep.equal(['stop_loss']);
  });

  it('respects cooldown and validates its input', () => {
    const ev = compileStrategy(parseStrategyDsl({ ...MINIMAL(), execution: { cooldownBars: 3 } }));
    expect(ev.evaluate({ candles: candles(SERIES), barsSinceLastExit: 2 })).to.deep.include({ signal: 'hold', reasons: ['cooldown'] });
    expect(ev.evaluate({ candles: candles(SERIES), barsSinceLastExit: 3 }).signal).to.equal('enter');
    const c = candles(SERIES);
    const bad = [
      { candles: c.map((x, i) => (i === 3 ? { ...x, close: 10 } : x)) },
      { candles: c.map((x, i) => (i === 3 ? { ...x, openTime: 0 } : x)) },
      { candles: c.map((x, i) => (i === 3 ? { ...x, high: '1' } : x)) },
      { candles: c, position: { side: 'short', entryPrice: '10', barsHeld: 1 } },
      { candles: c, position: { side: 'long', entryPrice: '0', barsHeld: 1 } },
      { candles: 'nope' },
      { candles: c, barsSinceLastExit: -1 },
    ];
    for (const input of bad) expect(codeOf(() => ev.evaluate(input))).to.equal('INPUT_INVALID');
  });

  it('refuses a definition that does not match its hash', () => {
    const p = parseStrategyDsl(MINIMAL());
    const tampered = { ...p, definition: { ...structuredClone(p.definition), risk: { stopLossPct: '50' } } };
    expect(codeOf(() => compileStrategy(tampered))).to.equal('CONFIG');
    expect(codeOf(() => compileStrategy({ definition: p.definition }))).to.equal('CONFIG');
  });
});

describe('strategy lifecycle: guarded transitions', () => {
  const H = 'sha256:' + 'a'.repeat(64);
  const human = { principalId: 'prn_alice', kind: 'human' };
  const platform = { principalId: 'prn_risk_engine', kind: 'platform' };
  const agent = { principalId: 'prn_bot', kind: 'agent' };
  const approval = { approvedBy: 'prn_alice', note: 'reviewed' };
  const ALL_FLAGS_ON = Object.fromEntries(['TRADING_AGENT', 'LIVE_SMALL', 'LIVE_TRADING', 'AUTONOMOUS_MODE'].map((f) => [tradingFlagEnvName(f), 'true']));
  const ENV = { [tradingFlagEnvName('TRADING_AGENT')]: 'true' };

  it('the legal edge set is exactly the documented graph (all 7×7 pairs)', () => {
    const states = Object.values(S);
    const legal = [];
    for (const from of states) for (const to of states) for (const pf of [null, S.PAPER, S.LIVE_SMALL, S.LIVE]) {
      if (isLegalTransition(from, to, pf)) legal.push(`${from}>${to}${from === S.PAUSED ? `@${pf}` : ''}`);
    }
    expect([...new Set(legal)].sort()).to.deep.equal([
      'BACKTESTED>PAPER', 'BACKTESTED>RETIRED', 'DRAFT>BACKTESTED', 'DRAFT>RETIRED',
      'LIVE>PAUSED', 'LIVE>RETIRED', 'LIVE_SMALL>LIVE', 'LIVE_SMALL>PAUSED', 'LIVE_SMALL>RETIRED',
      'PAPER>LIVE_SMALL', 'PAPER>PAUSED', 'PAPER>RETIRED',
      'PAUSED>LIVE@LIVE', 'PAUSED>LIVE_SMALL@LIVE_SMALL',
      'PAUSED>PAPER@LIVE', 'PAUSED>PAPER@LIVE_SMALL', 'PAUSED>PAPER@PAPER', 'PAUSED>PAPER@null',
      'PAUSED>RETIRED@LIVE', 'PAUSED>RETIRED@LIVE_SMALL', 'PAUSED>RETIRED@PAPER', 'PAUSED>RETIRED@null',
    ].sort());
    expect(TRANSITIONS[S.RETIRED]).to.deep.equal([]);
  });

  it('rejects every illegal transition with ILLEGAL_TRANSITION, whatever the actor and evidence', () => {
    const states = Object.values(S);
    let n = 0;
    for (const from of states) for (const to of states) {
      if (isLegalTransition(from, to, S.LIVE)) continue;
      if (from === S.PAUSED && isLegalTransition(from, to, S.LIVE_SMALL)) continue;
      n += 1;
      expect(codeOf(() => checkTransition({ from, to, actor: human, evidence: {}, definitionHash: H, pausedFrom: S.LIVE, env: ALL_FLAGS_ON })), `${from}>${to}`).to.equal('ILLEGAL_TRANSITION');
    }
    expect(n).to.be.greaterThan(25);
    expect(codeOf(() => checkTransition({ from: S.PAUSED, to: S.LIVE, actor: human, evidence: { approval, mandateId: 'mdt_1' }, definitionHash: H, pausedFrom: S.PAPER, env: ALL_FLAGS_ON }))).to.equal('ILLEGAL_TRANSITION');
    expect(codeOf(() => checkTransition({ from: 'BOGUS', to: S.DRAFT, actor: human, definitionHash: H }))).to.equal('ILLEGAL_TRANSITION');
  });

  it('agents can never move a strategy', () => {
    const cases = [
      [S.DRAFT, S.BACKTESTED, { backtest: { backtestId: 'bkt_00000001', definitionHash: H, bars: 1000, passed: true } }],
      [S.BACKTESTED, S.PAPER, { approval: { approvedBy: 'prn_bot', note: 'x' } }],
      [S.PAPER, S.PAUSED, { reason: 'x' }],
      [S.PAPER, S.RETIRED, { reason: 'x' }],
    ];
    for (const [from, to, evidence] of cases) expect(codeOf(() => checkTransition({ from, to, actor: agent, evidence, definitionHash: H, env: ALL_FLAGS_ON })), `${from}>${to}`).to.equal('GUARD_FAILED');
  });

  it('binds evidence to the version hash and enforces thresholds', () => {
    const bt = (over) => ({ backtest: { backtestId: 'bkt_00000001', definitionHash: H, bars: 1000, passed: true, ...over } });
    expect(checkTransition({ from: S.DRAFT, to: S.BACKTESTED, actor: platform, evidence: bt({}), definitionHash: H })).to.deep.include({ to: S.BACKTESTED });
    for (const over of [{ definitionHash: 'sha256:' + 'b'.repeat(64) }, { passed: false }, { bars: 499 }, { backtestId: 'bad' }]) {
      expect(codeOf(() => checkTransition({ from: S.DRAFT, to: S.BACKTESTED, actor: platform, evidence: bt(over), definitionHash: H })), JSON.stringify(over)).to.equal('GUARD_FAILED');
    }
    expect(codeOf(() => checkTransition({ from: S.DRAFT, to: S.BACKTESTED, actor: platform, evidence: { ...bt({}), reason: 'extra' }, definitionHash: H }))).to.equal('GUARD_FAILED');
    expect(codeOf(() => checkTransition({ from: S.BACKTESTED, to: S.PAPER, actor: human, evidence: { approval: { approvedBy: 'prn_mallory', note: 'x' } }, definitionHash: H, env: ENV }))).to.equal('GUARD_FAILED');
  });

  it('PAPER needs TRADING_AGENT; LIVE_SMALL and LIVE are impossible while LIVE_TRADING is locked', () => {
    expect(codeOf(() => checkTransition({ from: S.BACKTESTED, to: S.PAPER, actor: human, evidence: { approval }, definitionHash: H }))).to.equal('GUARD_FAILED');
    expect(checkTransition({ from: S.BACKTESTED, to: S.PAPER, actor: human, evidence: { approval }, definitionHash: H, env: ENV }).to).to.equal(S.PAPER);
    const paper = { paperRunId: 'ppr_00000001', definitionHash: H, days: 60, trades: 100 };
    const liveSmall = { liveRunId: 'lsr_00000001', definitionHash: H, days: 90, trades: 100 };
    let err;
    try { checkTransition({ from: S.PAPER, to: S.LIVE_SMALL, actor: human, evidence: { approval, paper, mandateId: 'mdt_1' }, definitionHash: H, env: ALL_FLAGS_ON }); } catch (e) { err = e; }
    expect(err.code).to.equal('GUARD_FAILED');
    expect(err.details.failures).to.deep.equal(['flag LIVE_TRADING is not enabled (LOCKED)']);
    expect(codeOf(() => checkTransition({ from: S.LIVE_SMALL, to: S.LIVE, actor: human, evidence: { approval, liveSmall, mandateId: 'mdt_1' }, definitionHash: H, env: ALL_FLAGS_ON }))).to.equal('GUARD_FAILED');
    expect(codeOf(() => checkTransition({ from: S.PAUSED, to: S.LIVE, actor: human, evidence: { approval, mandateId: 'mdt_1' }, definitionHash: H, pausedFrom: S.LIVE, env: ALL_FLAGS_ON }))).to.equal('GUARD_FAILED');
  });

  it('pausing records where it paused from; platform may pause, only humans retire', () => {
    expect(checkTransition({ from: S.PAPER, to: S.PAUSED, actor: platform, evidence: { reason: 'risk breach' }, definitionHash: H })).to.deep.include({ pausedFrom: S.PAPER });
    expect(codeOf(() => checkTransition({ from: S.PAPER, to: S.RETIRED, actor: platform, evidence: { reason: 'x' }, definitionHash: H }))).to.equal('GUARD_FAILED');
    expect(codeOf(() => checkTransition({ from: S.PAPER, to: S.PAUSED, actor: human, evidence: {}, definitionHash: H }))).to.equal('GUARD_FAILED');
  });

  it('projects version states onto the 021 strategies.status values', () => {
    expect(statusProjection([])).to.equal('draft');
    expect(statusProjection([S.DRAFT, S.BACKTESTED])).to.equal('draft');
    expect(statusProjection([S.RETIRED, S.PAPER])).to.equal('active');
    expect(statusProjection([S.RETIRED, S.PAUSED])).to.equal('paused');
    expect(statusProjection([S.RETIRED, S.RETIRED])).to.equal('archived');
  });
});

describe('strategy service (in-memory store)', () => {
  const alice = { principalId: 'prn_alice', kind: 'human' };
  const bob = { principalId: 'prn_bob', kind: 'human' };
  const ENV = { [tradingFlagEnvName('TRADING_AGENT')]: 'true' };
  const mk = () => {
    let n = 0;
    const store = new InMemoryStrategyStore();
    const svc = new StrategyService({ store, clock: () => new Date('2026-10-04T00:00:00Z'), idFactory: (p) => `${p}_${String(++n).padStart(4, '0')}`, env: ENV });
    return { store, svc };
  };
  const backtest = (hash) => ({ backtest: { backtestId: 'bkt_00000001', definitionHash: hash, bars: 1000, passed: true } });

  it('versions are immutable and idempotent by content hash', async () => {
    const { store, svc } = mk();
    const s = await svc.createStrategy({ actor: alice, name: 'Trend' });
    const v1 = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: GOLDEN() });
    expect(v1).to.deep.include({ version: 1, created: true, definitionHash: GOLDEN_HASH });
    const again = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: JSON.stringify(GOLDEN(), null, 2) });
    expect(again).to.deep.include({ id: v1.id, version: 1, created: false });
    const v2 = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: set(GOLDEN(), ['risk', 'stopLossPct'], '3') });
    expect(v2).to.deep.include({ version: 2, created: true });
    expect((await svc.getVersion(v1.id)).state).to.equal(S.DRAFT);
    expect(typeof store.updateVersion).to.equal('undefined');
    store.versions.get(v1.id).definition.risk.stopLossPct = '49'; // simulate tampering at rest
    expect(await svc.getVersion(v1.id).catch((e) => e.code)).to.equal('CONFLICT');
    expect(await svc.compileVersion(v1.id).catch((e) => e.code)).to.equal('CONFLICT');
  });

  it('runs DRAFT → BACKTESTED → PAPER → PAUSED → PAPER → RETIRED with an audit trail and status projection', async () => {
    const { store, svc } = mk();
    const s = await svc.createStrategy({ actor: alice, name: 'Trend' });
    const v = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: MINIMAL() });
    const step = (to, expectedFrom, evidence, actor = alice) => svc.transition({ actor, versionId: v.id, to, expectedFrom, evidence });
    await step(S.BACKTESTED, S.DRAFT, backtest(v.definitionHash));
    expect((await step(S.PAPER, S.BACKTESTED, { approval: { approvedBy: 'prn_alice', note: 'go' } })).strategyStatus).to.equal('active');
    expect((await step(S.PAUSED, S.PAPER, { reason: 'drawdown' }, { principalId: 'prn_risk', kind: 'platform' })).strategyStatus).to.equal('paused');
    await step(S.PAPER, S.PAUSED, { approval: { approvedBy: 'prn_alice', note: 'resume' } });
    expect((await step(S.RETIRED, S.PAPER, { reason: 'done' })).strategyStatus).to.equal('archived');
    expect(await step(S.DRAFT, S.RETIRED, {}).catch((e) => e.code)).to.equal('ILLEGAL_TRANSITION');
    const trail = store.audit.filter((a) => a.targetId === v.id).map((a) => [a.action, a.actorType, a.payload.to ?? null]);
    expect(trail).to.deep.equal([
      ['strategy.version_created', 'user', null], ['strategy.lifecycle', 'user', 'DRAFT'], ['strategy.lifecycle', 'user', 'BACKTESTED'],
      ['strategy.lifecycle', 'user', 'PAPER'], ['strategy.lifecycle', 'system', 'PAUSED'], ['strategy.lifecycle', 'user', 'PAPER'], ['strategy.lifecycle', 'user', 'RETIRED'],
    ]);
    expect(store.strategies.get(s.id).status).to.equal('archived');
  });

  it('stale expectedFrom → CONFLICT; concurrent transitions: exactly one wins', async () => {
    const { svc } = mk();
    const s = await svc.createStrategy({ actor: alice, name: 'Trend' });
    const v = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: MINIMAL() });
    expect(await svc.transition({ actor: alice, versionId: v.id, to: S.BACKTESTED, expectedFrom: S.BACKTESTED, evidence: backtest(v.definitionHash) }).catch((e) => e.code)).to.equal('CONFLICT');
    const results = await Promise.allSettled([1, 2, 3].map(() => svc.transition({ actor: alice, versionId: v.id, to: S.BACKTESTED, expectedFrom: S.DRAFT, evidence: backtest(v.definitionHash) })));
    expect(results.filter((r) => r.status === 'fulfilled')).to.have.length(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason.code)).to.deep.equal(['CONFLICT', 'CONFLICT']);
  });

  it('one deployed version per strategy; owners only; humans author', async () => {
    const { svc } = mk();
    const s = await svc.createStrategy({ actor: alice, name: 'Trend' });
    const a = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: MINIMAL() });
    const b = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: set(MINIMAL(), ['risk', 'stopLossPct'], '3') });
    for (const v of [a, b]) await svc.transition({ actor: alice, versionId: v.id, to: S.BACKTESTED, expectedFrom: S.DRAFT, evidence: backtest(v.definitionHash) });
    const approval = { approval: { approvedBy: 'prn_alice', note: 'go' } };
    await svc.transition({ actor: alice, versionId: a.id, to: S.PAPER, expectedFrom: S.BACKTESTED, evidence: approval });
    expect(await svc.transition({ actor: alice, versionId: b.id, to: S.PAPER, expectedFrom: S.BACKTESTED, evidence: approval }).catch((e) => e.code)).to.equal('GUARD_FAILED');
    expect(await svc.transition({ actor: bob, versionId: a.id, to: S.PAUSED, expectedFrom: S.PAPER, evidence: { reason: 'x' } }).catch((e) => e.code)).to.equal('NOT_FOUND');
    expect(await svc.createVersion({ actor: bob, strategyId: s.id, dsl: MINIMAL() }).catch((e) => e.code)).to.equal('NOT_FOUND');
    expect(await svc.createStrategy({ actor: { principalId: 'prn_bot', kind: 'agent' }, name: 'x' }).catch((e) => e.code)).to.equal('GUARD_FAILED');
    expect(await svc.createVersion({ actor: { principalId: 'prn_bot', kind: 'agent' }, strategyId: s.id, dsl: MINIMAL() }).catch((e) => e.code)).to.equal('GUARD_FAILED');
  });

  it('defaults to every flag off (never reads process.env)', async () => {
    let n = 0;
    const svc = new StrategyService({ store: new InMemoryStrategyStore(), idFactory: (p) => `${p}_${++n}` });
    const s = await svc.createStrategy({ actor: alice, name: 'Trend' });
    const v = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: MINIMAL() });
    await svc.transition({ actor: alice, versionId: v.id, to: S.BACKTESTED, expectedFrom: S.DRAFT, evidence: backtest(v.definitionHash) });
    const prev = process.env[tradingFlagEnvName('TRADING_AGENT')];
    process.env[tradingFlagEnvName('TRADING_AGENT')] = 'true';
    try {
      expect(await svc.transition({ actor: alice, versionId: v.id, to: S.PAPER, expectedFrom: S.BACKTESTED, evidence: { approval: { approvedBy: 'prn_alice', note: 'go' } } }).catch((e) => e.code)).to.equal('GUARD_FAILED');
    } finally {
      if (prev === undefined) delete process.env[tradingFlagEnvName('TRADING_AGENT')]; else process.env[tradingFlagEnvName('TRADING_AGENT')] = prev;
    }
  });
});
