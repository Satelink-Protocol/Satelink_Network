import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newTrace, childSpan, formatTraceparent, parseTraceparent, fromRequestTraceId, runWithTrace, runInSpan, currentTrace,
  tracedPool, TradeReceiptAssembler, RECEIPT_VERSION, AuditError,
} from '../src/trading_agent/audit/index.mjs';

// Stage 19 — audit trail, trace propagation, trade receipts. Pure: no network, no DB, no process.env.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.resolve(HERE, '../src/trading_agent/audit');
const SECRET = ['sk', 'ant', 'api03', 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3'].join('-'); // built from parts (pre-commit gate)

describe('audit: W3C trace context', () => {
  it('creates valid ids and round-trips traceparent', () => {
    const t = newTrace();
    expect(t.traceId).to.match(/^[0-9a-f]{32}$/);
    expect(t.spanId).to.match(/^[0-9a-f]{16}$/);
    const tp = formatTraceparent(t);
    expect(tp).to.equal(`00-${t.traceId}-${t.spanId}-01`);
    expect(parseTraceparent(tp)).to.deep.include({ traceId: t.traceId, spanId: t.spanId, sampled: true });
    const c = childSpan(t);
    expect([c.traceId, c.parentSpanId]).to.deep.equal([t.traceId, t.spanId]);
    expect(c.spanId).to.not.equal(t.spanId);
  });

  it('ignores invalid traceparent headers (W3C: start a new trace)', () => {
    const z32 = '0'.repeat(32);
    for (const h of [null, '', 'garbage', `ff-${'a'.repeat(32)}-${'b'.repeat(16)}-01`, `00-${z32}-${'b'.repeat(16)}-01`, `00-${'a'.repeat(32)}-${'0'.repeat(16)}-01`, `00-${'a'.repeat(31)}-${'b'.repeat(16)}-01`, `00-${'A'.repeat(32)}x-${'b'.repeat(16)}-01`]) {
      expect(parseTraceparent(h), String(h)).to.equal(null);
    }
    expect(parseTraceparent(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-00`).sampled).to.equal(false);
  });

  it('continues an existing X-Trace-ID (UUID) without changing that header', () => {
    const t = fromRequestTraceId('3F2504E0-4F89-11D3-9A0C-0305E82C3301');
    expect(t.traceId).to.equal('3f2504e04f8911d39a0c0305e82c3301');
    expect(fromRequestTraceId('not-a-uuid')).to.equal(null);
    expect(fromRequestTraceId('00000000-0000-0000-0000-000000000000')).to.equal(null);
  });

  it('propagates through async work, nests spans, and keeps concurrent traces apart', async () => {
    expect(currentTrace()).to.equal(null);
    const a = newTrace();
    const b = newTrace();
    const seen = await Promise.all([
      runWithTrace(a, async () => { await new Promise((r) => setTimeout(r, 5)); return currentTrace().traceId; }),
      runWithTrace(b, async () => { await new Promise((r) => setImmediate(r)); return currentTrace().traceId; }),
    ]);
    expect(seen).to.deep.equal([a.traceId, b.traceId]);
    await runWithTrace(a, async () => {
      const inner = await runInSpan(async () => currentTrace());
      expect([inner.traceId, inner.parentSpanId]).to.deep.equal([a.traceId, a.spanId]);
      expect(currentTrace()).to.equal(a);
    });
    expect(currentTrace()).to.equal(null);
    expect(() => runWithTrace({ traceId: 'x', spanId: 'y' }, () => 1)).to.throw(AuditError);
  });
});

describe('audit: tracedPool carries the context into Postgres and never leaks it', () => {
  function fakePool({ failSet = false } = {}) {
    const log = [];
    const pool = {
      totalCount: 1, idleCount: 1,
      async connect() {
        const id = log.filter((l) => l[0] === 'connect').length + 1;
        log.push(['connect', id]);
        return {
          async query(text, params) {
            if (failSet && /set_config\('satelink.trace_id', \$1/.test(text)) throw new Error('set failed');
            log.push(['query', id, text.includes('set_config') ? (params ? `SET ${params.join('|')}` : 'CLEAR') : text]);
            return { rows: [] };
          },
          release(err) { log.push(['release', id, err ? 'err' : 'ok']); },
        };
      },
      async query() { throw new Error('raw pool.query must not be used by tracedPool'); },
      async end() {},
    };
    return { pool, log };
  }

  it('sets trace/span at checkout and clears them before releasing', async () => {
    const { pool, log } = fakePool();
    const tp = tracedPool(pool);
    const t = newTrace();
    await runWithTrace(t, async () => {
      await tp.query('INSERT 1');
      const c = await tp.connect();
      await c.query('INSERT 2');
      c.release();
      c.release(); // double release is ignored
    });
    await new Promise((r) => setImmediate(r));
    expect(log).to.deep.equal([
      ['connect', 1], ['query', 1, `SET ${t.traceId}|${t.spanId}`], ['query', 1, 'INSERT 1'], ['query', 1, 'CLEAR'], ['release', 1, 'ok'],
      ['connect', 2], ['query', 2, `SET ${t.traceId}|${t.spanId}`], ['query', 2, 'INSERT 2'], ['query', 2, 'CLEAR'], ['release', 2, 'ok'],
    ]);
  });

  it('outside a trace it explicitly clears (a recycled connection cannot inherit an old trace)', async () => {
    const { pool, log } = fakePool();
    await tracedPool(pool).query('INSERT 3');
    await new Promise((r) => setImmediate(r));
    expect(log[1]).to.deep.equal(['query', 1, 'SET |']);
  });

  it('a failing SET releases the connection as broken and throws', async () => {
    const { pool, log } = fakePool({ failSet: true });
    let err;
    try { await runWithTrace(newTrace(), () => tracedPool(pool).query('INSERT 4')); } catch (e) { err = e; }
    expect(err.message).to.equal('set failed');
    expect(log.at(-1)).to.deep.equal(['release', 1, 'err']);
    expect(log.some((l) => l[2] === 'INSERT 4')).to.equal(false);
  });
});

// ── receipt assembler (in-memory source) ──────────────────────────────────────
const TRACE = 'a'.repeat(32);
const at = (s) => new Date(Date.UTC(2026, 9, 6, 9, 0, s));
function source(over = {}) {
  const base = {
    order: { id: 'ord_1', principalId: 'prn_alice', mandateId: 'mdt_1', riskDecisionId: 'rdc_1', mandateTermsHash: `sha256:${'1'.repeat(64)}`, instrument: 'BTC-USDT', side: 'buy', orderType: 'market', quantity: '0.002', limitPrice: null, venue: 'mock', mode: 'paper', clientOrderId: 'sl123', brokerOrderId: 'mock-ord-1', status: 'filled', filledQuantity: '0.002', avgFillPrice: '30000', createdAt: at(3), sentAt: at(4), acknowledgedAt: at(5), traceId: TRACE, spanId: 'b'.repeat(16) },
    events: [
      { eventType: 'accepted', fromStatus: null, toStatus: 'approved', actor: 'system:oms', createdAt: at(3), traceId: TRACE, spanId: 'c'.repeat(16) },
      { eventType: 'dispatch', fromStatus: 'approved', toStatus: 'submitted', actor: 'system:dispatcher', createdAt: at(4), traceId: TRACE, spanId: 'd'.repeat(16) },
      { eventType: 'broker_status', fromStatus: 'submitted', toStatus: 'filled', actor: 'system:dispatcher', createdAt: at(5), traceId: TRACE, spanId: 'e'.repeat(16) },
    ],
    fills: [{ brokerFillId: 'mock-fill-1', quantity: '0.002', price: '30000', feeMinor: '6', feeCurrency: 'USDT', executedAt: at(5), ledgerTxnId: null, traceId: TRACE, spanId: 'f'.repeat(16) }],
    decision: { decisionId: 'rdc_1', decision: 'APPROVE', checksVersion: 'risk-checks/1.0', engineVersion: 'risk-1.0', policy: { id: 'rsk_1', version: 1, hash: `sha256:${'2'.repeat(64)}` }, trace: Array.from({ length: 20 }, (_, i) => ({ n: i + 1, outcome: 'pass' })), failedCheck: null },
    mandate: { id: 'mdt_1', mode: 'copilot', modeCode: 'A', status: 'active', termsHash: `sha256:${'1'.repeat(64)}`, signedAt: at(0), stepUpMethod: 'totp', approvedBy: 'prn_alice' },
    runs: [{ id: 'run_1', principalId: 'prn_alice', status: 'completed', goalRedacted: `buy a little BTC; my key is ${SECRET}`, finalOutputRedacted: 'proposed', startedAt: at(1), spanId: '1'.repeat(16) }],
    toolCalls: [{ runId: 'run_1', seq: 1, toolName: 'get_quote', tier: 'READ', status: 'ok' }, { runId: 'run_1', seq: 2, toolName: 'propose_order', tier: 'CONTROLLED', status: 'ok' }],
    signals: [],
    audits: [{ occurredAt: at(2), actorType: 'system', actorId: 'risk-engine', principalId: 'prn_alice', action: 'risk.decision', spanId: '2'.repeat(16) }],
    ...over,
  };
  return {
    async order(id) { return id === base.order.id ? base.order : null; },
    async orderEvents() { return base.events; },
    async fills() { return base.fills; },
    async riskDecision(id) { return base.decision?.decisionId === id ? base.decision : null; },
    async mandate(id) { return base.mandate?.id === id ? base.mandate : null; },
    async agentRuns(t) { return t === TRACE ? base.runs : []; },
    async toolCalls() { return base.toolCalls; },
    async signals() { return base.signals; },
    async auditByTrace() { return base.audits; },
  };
}
const explain = (src, principalId = 'prn_alice') => new TradeReceiptAssembler({ source: src, clock: () => at(59) }).explainOrder({ principalId, orderId: 'ord_1' });

describe('audit: "Why did Satelink do this?" receipt', () => {
  it('a full chain is complete: WHO / WHAT / WHEN / WHY, fills, ledger honestly "not posted"', async () => {
    const r = await explain(source());
    expect(r).to.deep.include({ receipt: RECEIPT_VERSION, orderId: 'ord_1', traceId: TRACE, traceparent: `00-${TRACE}-${'b'.repeat(16)}-01` });
    expect(r.completeness).to.deep.include({ complete: true, missing: [] });
    expect(r.who).to.deep.include({ principalId: 'prn_alice', agentRuns: ['run_1'], mandateSignedBy: 'prn_alice' });
    expect(r.who.actors).to.deep.equal(['system:dispatcher', 'system:oms', 'system:risk-engine']);
    expect(r.what).to.deep.include({ instrument: 'BTC-USDT', side: 'buy', status: 'filled', filledQuantity: '0.002' });
    expect(r.why.origin).to.equal('agent');
    expect(r.why.agentRuns[0].toolCalls.map((t) => t.tool)).to.deep.equal(['get_quote', 'propose_order']);
    expect(r.why.mandate).to.deep.include({ mode: 'A', matchesOrder: true, stepUpMethod: 'totp' });
    expect(r.why.risk).to.deep.include({ decision: 'APPROVE', checksPassed: 20, checksTotal: 20 });
    expect(r.when.timeline.map((x) => x.kind)).to.deep.equal(['agent_run', 'risk.decision', 'order.accepted', 'order.dispatch', 'order.broker_status', 'fill']);
    expect(r.ledger).to.deep.include({ posted: false, ledgerTxnIds: [] });
    expect(r.receiptHash).to.match(/^sha256:[0-9a-f]{64}$/);
  });

  it('redacts secrets anywhere in the receipt (and the hash covers the redacted body)', async () => {
    const r = await explain(source());
    const json = JSON.stringify(r);
    expect(json).to.not.include(SECRET);
    expect(r.why.agentRuns[0].goal).to.include('[REDACTED]');
    const again = await explain(source());
    expect(again.receiptHash).to.equal(r.receiptHash); // deterministic for the same chain
  });

  it('reports exactly which hop is missing or inconsistent', async () => {
    const cases = [
      [{ decision: null }, 'risk'],
      [{ decision: { decisionId: 'rdc_1', decision: 'REJECT', trace: [] } }, 'risk'],
      [{ mandate: { id: 'mdt_1', termsHash: `sha256:${'9'.repeat(64)}` } }, 'mandate'],
      [{ fills: [] }, 'fills'],
      [{ events: [{ eventType: 'accepted', toStatus: 'approved', actor: 'x', createdAt: at(3), traceId: TRACE }] }, 'dispatch'],
    ];
    for (const [over, hop] of cases) {
      const r = await explain(source(over));
      expect(r.completeness.complete, hop).to.equal(false);
      expect(r.completeness.missing, hop).to.include(hop);
    }
    const s = source();
    const broken = { ...s, async fills() { return [{ ...(await s.fills())[0], traceId: 'c'.repeat(32) }]; } };
    expect((await explain(broken)).completeness.missing).to.deep.equal(['trace']);
    const manual = await explain(source({ runs: [] }));
    expect([manual.why.origin, manual.completeness.complete]).to.deep.equal(['manual', true]);
  });

  it('is tenant-scoped: another principal gets NOT_FOUND; other tenants\' runs on the trace are excluded', async () => {
    let err;
    try { await explain(source(), 'prn_bob'); } catch (e) { err = e; }
    expect(err.code).to.equal('NOT_FOUND');
    const r = await explain(source({ runs: [{ id: 'run_x', principalId: 'prn_bob', status: 'completed', goalRedacted: 'x', startedAt: at(1) }] }));
    expect(r.who.agentRuns).to.deep.equal([]);
  });
});

describe('audit: does not touch existing log formats or the ledger (static)', () => {
  it('audit/** imports no logger, ledger, billing or settlement code and reads no env', () => {
    for (const f of fs.readdirSync(AUDIT_DIR).filter((x) => x.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(AUDIT_DIR, f), 'utf8').replace(/\/\/.*$/gm, '');
      const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) expect(s, `${f} → ${s}`).to.not.match(/pino|winston|logger|tracing\.js|ledger|billing|settlement|^@opentelemetry/);
      expect(src, f).to.not.match(/process\.env|console\.(log|info|warn|error)|INSERT INTO (ledger|journal)/);
    }
  });
});
