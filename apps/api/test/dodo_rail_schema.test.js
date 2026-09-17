import { expect } from 'chai';
import { ensureDodoRailSchema } from '../src/db/dodo_rail_schema.js';
import { isDodoSchemaReady, setDodoSchemaReady } from '../src/db/dodo_schema_state.js';

// Mock pg client/pool that records executed SQL and returns canned rows for the
// constraint-def and DISTINCT-source lookups. `failOn` makes a matching query throw.
function makeClient({ def, present = [], failOn } = {}) {
  const executed = [];
  return {
    executed,
    async query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').trim();
      executed.push(s);
      if (failOn && s.includes(failOn)) throw new Error('simulated DDL failure');
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: '' }] };
      if (s.includes('pg_get_constraintdef')) return { rows: def === undefined ? [] : [{ def }] };
      if (s.includes('SELECT DISTINCT source')) return { rows: present.map((source) => ({ source })) };
      return { rows: [] };
    },
    release() {},
  };
}
function makePool(opts) {
  const client = makeClient(opts);
  return { _client: client, async connect() { return client; } };
}
const silent = { log() {}, error() {} };

describe('ensureDodoRailSchema — hardened boot DDL', () => {
  let alerts;
  const notifier = (title, msg) => { alerts.push({ title, msg }); };
  beforeEach(() => { alerts = []; setDodoSchemaReady(true); });
  afterEach(() => { setDodoSchemaReady(true); }); // never leak "not ready" to other files

  it('(1c) skips the constraint recreate when it already allows dodo', async () => {
    const pool = makePool({ def: `CHECK ((source = ANY (ARRAY['x402'::text, 'dodo'::text])))`, present: ['x402'] });
    const r = await ensureDodoRailSchema(pool, { logger: silent, notifier });
    expect(r.ok).to.equal(true);
    expect(r.skippedConstraint).to.equal(true);
    expect(pool._client.executed.some((s) => s.includes('DROP CONSTRAINT'))).to.equal(false);
    expect(pool._client.executed.some((s) => s.includes('pg_advisory_xact_lock'))).to.equal(true);
    expect(isDodoSchemaReady()).to.equal(true);
  });

  it('(1a) preserves unknown prod values + adds dodo, and reports the unknowns', async () => {
    const pool = makePool({
      def: `CHECK (source IN ('polygon_usdt_vault', 'x402', 'legacy_rail'))`, // no dodo
      present: ['legacy_rail', 'x402'],
    });
    const r = await ensureDodoRailSchema(pool, { logger: silent, notifier });
    expect(r.ok).to.equal(true);
    expect(r.skippedConstraint).to.equal(false);
    expect(r.unknownSources).to.include('legacy_rail');
    const addSql = pool._client.executed.find((s) => s.includes('ADD CONSTRAINT payment_sources_source_check'));
    expect(addSql, 'expected an ADD CONSTRAINT').to.exist;
    expect(addSql).to.include(`'legacy_rail'`);   // unknown value preserved
    expect(addSql).to.include(`'dodo'`);          // dodo added
    expect(addSql).to.include('NOT VALID');       // (1b) no boot-time validation scan
    expect(alerts.some((a) => /unknown/i.test(a.title))).to.equal(true); // reported
    expect(isDodoSchemaReady()).to.equal(true);
  });

  it('(1e) on DDL failure: rolls back, marks NOT ready, alerts, and does NOT throw', async () => {
    const pool = makePool({ def: `CHECK (source IN ('x402'))`, present: ['x402'], failOn: 'ADD CONSTRAINT' });
    const r = await ensureDodoRailSchema(pool, { logger: silent, notifier });
    expect(r.ok).to.equal(false);          // returned, not thrown → server keeps booting
    expect(isDodoSchemaReady()).to.equal(false);
    expect(pool._client.executed).to.include('ROLLBACK');
    expect(alerts.some((a) => /failed/i.test(a.title))).to.equal(true);
  });

  it('no pool → not ready, no throw', async () => {
    const r = await ensureDodoRailSchema(null, { logger: silent, notifier });
    expect(r.ok).to.equal(false);
    expect(isDodoSchemaReady()).to.equal(false);
  });
});
