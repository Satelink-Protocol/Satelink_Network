// T-21 (2026-09-15): phantom revenue writers must record is_billable = false.
//
// These six workloads INSERT into revenue_events_v2 without deducting any
// credit or settling any payment (audit/02_INVENTORY.md B5, 03_MONEY_GAPS G15).
// Migration 014 defaults is_billable to true, so an INSERT that omits the
// column silently claims a collected charge. The rows are kept as usage
// telemetry; they must simply never claim to be money.
//
// The writers are private functions behind routers that call external
// providers, so this test checks the SQL text itself: every INSERT INTO
// revenue_events_v2 in these files must name is_billable and bind it to the
// literal false. A new writer added without the flag fails the count check.

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const PHANTOM_WRITERS = {
  'workloads/ai_gateway/index.js': 1,
  'workloads/bandwidth_proxy/index.js': 2,
  'workloads/oracle/index.js': 1,
  'workloads/mev_relay/index.js': 1,
  'workloads/webhooks/index.js': 1,
  'workloads/rpc_gateway/ws_gateway.js': 1,
};

function revenueInserts(source) {
  const re = /INSERT INTO revenue_events_v2\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/g;
  return [...source.matchAll(re)].map((m) => ({
    columns: m[1].split(',').map((s) => s.trim()),
    values: m[2].split(',').map((s) => s.trim()),
  }));
}

describe('T-21 phantom revenue writers record is_billable = false', () => {
  for (const [file, expected] of Object.entries(PHANTOM_WRITERS)) {
    it(`${file}: every revenue_events_v2 INSERT binds is_billable to false`, () => {
      const inserts = revenueInserts(readFileSync(join(SRC, file), 'utf8'));
      expect(inserts, 'INSERT count changed — review the new writer').to.have.length(expected);
      for (const { columns, values } of inserts) {
        expect(columns.length).to.equal(values.length);
        const idx = columns.indexOf('is_billable');
        expect(idx, `is_billable missing from (${columns.join(', ')})`).to.be.at.least(0);
        expect(values[idx]).to.equal('false');
      }
    });
  }

  it('the matcher sees a column-less INSERT as a violation (guards the guard)', () => {
    const [ins] = revenueInserts(
      "INSERT INTO revenue_events_v2 (op_type, amount_usdt) VALUES ('ai_inference', $1)"
    );
    expect(ins.columns.indexOf('is_billable')).to.equal(-1);
  });
});
