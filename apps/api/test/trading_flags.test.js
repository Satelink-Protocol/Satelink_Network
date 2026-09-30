import { expect } from 'chai';
import {
  TRADING_FLAGS, LOCKED_TRADING_FLAGS, isTradingFlagEnabled, tradingFlagEnvName, tradingFlagSnapshot,
} from '../src/trading_agent/flags.mjs';
import { mountTradingRoutes, TRADING_MOUNT_PATH } from '../src/trading_agent/index.mjs';

// Stage 09: every trading flag defaults OFF; three are locked OFF regardless of env.
// Pure (no DB, no network). Uses an explicit env object so process.env is untouched.
describe('trading_agent flags (Stage 09)', () => {
  const EXPECTED = [
    'TRADING_AGENT', 'BINANCE', 'UPSTOX_COPILOT', 'UPSTOX_AUTOMATED', 'ALPACA', 'LIVE_TRADING',
    'LIVE_SMALL', 'BYOK', 'MCP_TRADING', 'AUTONOMOUS_MODE', 'REVENUE_ENGINE', 'SUBSCRIPTIONS',
  ];

  it('registers exactly the 12 required flags', () => {
    expect([...TRADING_FLAGS].sort()).to.deep.equal([...EXPECTED].sort());
  });

  it('defaults every flag to OFF with an empty environment', () => {
    for (const flag of TRADING_FLAGS) expect(isTradingFlagEnabled(flag, {}), flag).to.equal(false);
  });

  it('defaults every flag to OFF with the real process environment (no TRADING_FLAG_* set in CI)', () => {
    const set = Object.keys(process.env).filter((k) => k.startsWith('TRADING_FLAG_'));
    expect(set, 'TRADING_FLAG_* must not be set in the test environment').to.deep.equal([]);
    for (const flag of TRADING_FLAGS) expect(isTradingFlagEnabled(flag), flag).to.equal(false);
  });

  it('locks LIVE_TRADING, AUTONOMOUS_MODE and UPSTOX_AUTOMATED OFF even when env says true', () => {
    expect([...LOCKED_TRADING_FLAGS].sort()).to.deep.equal(['AUTONOMOUS_MODE', 'LIVE_TRADING', 'UPSTOX_AUTOMATED']);
    const env = Object.fromEntries(TRADING_FLAGS.map((f) => [tradingFlagEnvName(f), 'true']));
    for (const flag of LOCKED_TRADING_FLAGS) expect(isTradingFlagEnabled(flag, env), flag).to.equal(false);
  });

  it('enables an unlocked flag only for the exact string "true"', () => {
    expect(isTradingFlagEnabled('BINANCE', { TRADING_FLAG_BINANCE: 'true' })).to.equal(true);
    for (const v of ['1', 'TRUE', 'yes', 'on', ' true', '']) {
      expect(isTradingFlagEnabled('BINANCE', { TRADING_FLAG_BINANCE: v }), JSON.stringify(v)).to.equal(false);
    }
  });

  it('rejects unknown flag names', () => {
    expect(() => isTradingFlagEnabled('LIVE', {})).to.throw(/Unknown trading flag/);
  });

  it('snapshot reports requested vs effective state for locked flags', () => {
    const snap = tradingFlagSnapshot({ TRADING_FLAG_LIVE_TRADING: 'true' });
    expect(snap.LIVE_TRADING).to.deep.equal({ enabled: false, locked: true, requested: true });
    expect(snap.BINANCE).to.deep.equal({ enabled: false, locked: false, requested: false });
  });

  it('does not mount any route while TRADING_AGENT is off', () => {
    const app = { use() { throw new Error('must not mount'); } };
    expect(mountTradingRoutes(app, { env: {} })).to.deep.equal({ mounted: false, reason: 'TRADING_AGENT flag is off' });
  });

  it('mounts only /v1/trading when TRADING_AGENT is on', () => {
    const mounted = [];
    const app = { use(path) { mounted.push(path); } };
    expect(mountTradingRoutes(app, { env: { TRADING_FLAG_TRADING_AGENT: 'true' } })).to.deep.equal({ mounted: true });
    expect(mounted).to.deep.equal([TRADING_MOUNT_PATH]);
  });
});
