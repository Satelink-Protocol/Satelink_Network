import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTestnetFailure } from './helpers/testnet_failure.mjs';
import { BrokerError, mapVenueError } from '../src/trading_agent/brokers/errors.mjs';

// Stage 30 — support for the nightly E2E: testnet failure classification + the workflow's safety rules.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('stage 30: testnet failure classification (testnet resets are environment events)', () => {
  it('maps rejected keys, wiped balances, region blocks and transient outages to named reasons', () => {
    expect(classifyTestnetFailure(mapVenueError('binance', { sent: true, httpStatus: 401, venueCode: -2015, message: 'Invalid API-key, IP, or permissions for action.' }))).to.match(/^TESTNET_KEYS_REJECTED/);
    expect(classifyTestnetFailure(mapVenueError('binance', { sent: true, httpStatus: 400, venueCode: -2010, message: 'Account has insufficient balance for requested action.' }))).to.match(/^TESTNET_BALANCE_MISSING/);
    expect(classifyTestnetFailure(mapVenueError('binance', { sent: true, httpStatus: 451, message: 'Service unavailable from a restricted location' }))).to.match(/^TESTNET_REGION_BLOCKED/);
    expect(classifyTestnetFailure(mapVenueError('binance', { sent: false, message: 'ECONNREFUSED' }))).to.match(/^TESTNET_UNAVAILABLE/);
    expect(classifyTestnetFailure(new BrokerError('INVALID_REQUEST', { venue: 'binance', message: 'Filter failure: NOTIONAL' }))).to.match(/^TESTNET_UNEXPECTED/);
    expect(classifyTestnetFailure(new Error('boom'))).to.match(/^TESTNET_UNEXPECTED/);
  });
});

describe('stage 30: nightly workflow safety rules', () => {
  const raw = fs.readFileSync(path.join(ROOT, '.github/workflows/trading-e2e-nightly.yml'), 'utf8');
  const wf = raw.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, '')).join('\n'); // executable lines only
  it('runs only on schedule / manual dispatch, read-only token, no production or deploy steps', () => {
    expect(wf).to.match(/on:\n  schedule:\n    - cron: '30 20 \* \* \*'/);
    expect(wf).to.match(/  workflow_dispatch: \{\}/);
    expect(wf).to.not.match(/pull_request|push:/);
    expect(wf).to.match(/permissions:\n  contents: read/);
    expect(wf).to.not.match(/railway|vercel|deploy|(^|\s)DATABASE_URL:|api\.binance\.com|LIVE_TRADING/im); // TEST_DATABASE_URL (local guard DB) is fine
  });
  it('testnet secrets live only in the trading-testnet environment and the testnet job refuses to go green without them', () => {
    expect(wf).to.match(/environment: trading-testnet/);
    expect([...wf.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).every((s) => /^BINANCE_TESTNET_/.test(s))).to.equal(true);
    expect(wf).to.match(/TESTNET_SECRETS_MISSING/);
    expect(wf).to.not.match(/\| *tail/); // no masked exit codes
  });
});
