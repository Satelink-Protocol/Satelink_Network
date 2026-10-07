import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCKED_TRADING_FLAGS, isTradingFlagEnabled, tradingFlagEnvName } from '../src/trading_agent/flags.mjs';

// Gate 0 blocker register guard: open blockers can't silently become "solved".
// Source of truth: docs/trading-agent/BLOCKERS.md.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const REGISTER = path.join(ROOT, 'docs/trading-agent/BLOCKERS.md');
const STAGES_DIR = path.join(ROOT, 'docs/trading-agent/stages');
const STATUSES = new Set(['OPEN', 'PARTIAL', 'RESOLVED']);
const EXPECTED_IDS = Array.from({ length: 12 }, (_, i) => `B-${String(i + 1).padStart(2, '0')}`);

function parseRegister(md) {
  const section = md.split('## Register')[1].split('\n## ')[0];
  return section.split('\n')
    .filter((l) => /^\| B-\d\d \|/.test(l))
    .map((l) => {
      // cells are separated by " | "; an escaped "\|" inside a cell is not a separator
      const cells = l.replace(/\\\|/g, '\u0000').split('|').slice(1, -1).map((c) => c.trim().replace(/\u0000/g, '|'));
      const [id, status, category, gates, owner, verification, evidence] = cells;
      return { id, status, category, gates, owner, verification, evidence };
    });
}

const md = fs.readFileSync(REGISTER, 'utf8');
const rows = parseRegister(md);
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
const resolved = (id) => byId[id]?.status === 'RESOLVED';

describe('trading: Gate 0 blocker register', () => {
  it('lists exactly B-01…B-12, once each, and states Gate 0 is not passed while any is unresolved', () => {
    expect(rows.map((r) => r.id)).to.deep.equal(EXPECTED_IDS);
    if (rows.some((r) => r.status !== 'RESOLVED')) expect(md).to.match(/\*\*Gate 0 status: NOT PASSED\.\*\*/);
  });

  it('uses only OPEN / PARTIAL / RESOLVED ("accepted" is not a status)', () => {
    for (const r of rows) expect(STATUSES.has(r.status), `${r.id} status "${r.status}"`).to.equal(true);
  });

  it('a RESOLVED blocker must carry resolution evidence; an unresolved one must not claim any', () => {
    for (const r of rows) {
      if (r.status === 'RESOLVED') {
        expect(r.evidence, r.id).to.not.match(/^(—|-|)$/);
        expect(r.evidence.length, `${r.id} evidence too thin`).to.be.above(20);
      } else expect(r.evidence, `${r.id} is ${r.status} but has resolution evidence`).to.match(/^(—|-)$/);
      expect(r.owner, r.id).to.not.equal('');
      expect(r.gates, r.id).to.not.equal('');
    }
  });

  it('live, autonomous and automated-broker trading stay locked until B-06, B-08 and B-09 are all RESOLVED', () => {
    if (['B-06', 'B-08', 'B-09'].every(resolved)) return;
    for (const flag of ['LIVE_TRADING', 'AUTONOMOUS_MODE', 'UPSTOX_AUTOMATED']) {
      expect(LOCKED_TRADING_FLAGS.has(flag), `${flag} must be locked`).to.equal(true);
      expect(isTradingFlagEnabled(flag, { [tradingFlagEnvName(flag)]: 'true' }), flag).to.equal(false);
    }
  });

  it('the trading module is not mounted while B-03, B-06 or B-10 is unresolved', () => {
    if (['B-03', 'B-06', 'B-10'].every(resolved)) return;
    for (const f of ['apps/api/app_factory.mjs', 'apps/api/server.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, f).to.not.match(/trading_agent/);
    }
  });

  it('does not publish exploit detail for open security blockers (public repo)', () => {
    if (['B-01', 'B-02', 'B-03'].every(resolved)) return;
    expect(md).to.not.match(/api\/admin-proxy|\/system\/[a-z-]+\/trigger|node\/me\/withdraw|api_phase3|hooks\/[0-9]{6,}/i);
  });

  it('every stage doc from Stage 13 on has a "Blocker impact" section', () => {
    const docs = fs.readdirSync(STAGES_DIR).filter((f) => /^\d\d-.*\.md$/.test(f) && Number(f.slice(0, 2)) >= 13);
    for (const f of docs) {
      expect(fs.readFileSync(path.join(STAGES_DIR, f), 'utf8'), f).to.match(/^## Blocker impact$/m);
    }
  });
});
