import { describe, it, expect } from 'vitest';
import {
  evaluateGuardrails,
  filterFireOnce,
  DEFAULT_THRESHOLDS,
  type Metrics,
  type Alert,
} from './evaluate.js';

const GB = 1_073_741_824;
const base: Metrics = {
  revenueRowsLastHour: 0,
  ledgerRowsLastHour: 0,
  dbBytes: 0.6 * GB,
  walBytes: 0.1 * GB,
  volumeCapacityBytes: 5 * GB,
  staleDrivers: [],
};

describe('evaluateGuardrails — each condition fires on its trigger', () => {
  it('quiet baseline → no alerts', () => {
    expect(evaluateGuardrails(base, DEFAULT_THRESHOLDS)).to.have.length(0);
  });

  it('row_growth fires when ledger rows/hour exceed threshold (Aug-22 shape)', () => {
    const a = evaluateGuardrails({ ...base, revenueRowsLastHour: 55_000, ledgerRowsLastHour: 111_581 }, DEFAULT_THRESHOLDS);
    expect(a.map((x) => x.condition)).to.include('row_growth');
    expect(a.find((x) => x.condition === 'row_growth')!.severity).to.equal('critical');
  });

  it('volume_70 warns at ≥70%, volume_85 is critical at ≥85% (only one fires)', () => {
    const warn = evaluateGuardrails({ ...base, dbBytes: 3.6 * GB, walBytes: 0 }, DEFAULT_THRESHOLDS); // 72%
    expect(warn.map((x) => x.condition)).to.deep.equal(['volume_70']);
    const crit = evaluateGuardrails({ ...base, dbBytes: 4.3 * GB, walBytes: 0 }, DEFAULT_THRESHOLDS); // 86%
    expect(crit.map((x) => x.condition)).to.deep.equal(['volume_85']);
  });

  it('write_amplification fires when ratio drifts from 2:1 (a new writer)', () => {
    // ratio 3:1 with enough rows → alarm
    const a = evaluateGuardrails({ ...base, revenueRowsLastHour: 100, ledgerRowsLastHour: 300 }, DEFAULT_THRESHOLDS);
    expect(a.map((x) => x.condition)).to.include('write_amplification');
    // healthy 2:1 → no ratio alarm
    const ok = evaluateGuardrails({ ...base, revenueRowsLastHour: 100, ledgerRowsLastHour: 200 }, DEFAULT_THRESHOLDS);
    expect(ok.map((x) => x.condition)).to.not.include('write_amplification');
  });

  it('write_amplification is suppressed below the min-rows floor (noise guard)', () => {
    const a = evaluateGuardrails({ ...base, revenueRowsLastHour: 3, ledgerRowsLastHour: 30 }, DEFAULT_THRESHOLDS);
    expect(a.map((x) => x.condition)).to.not.include('write_amplification');
  });

  it('driver_liveness fires once per stale driver (the M9 control)', () => {
    const a = evaluateGuardrails(
      {
        ...base,
        staleDrivers: [
          { driverName: 'm9-endurance', minutesSinceHeartbeat: 8640, callsDone: 64, callsPlanned: 5000 },
          { driverName: 'other', minutesSinceHeartbeat: 20, callsDone: null, callsPlanned: null },
        ],
      },
      DEFAULT_THRESHOLDS,
    );
    const driver = a.filter((x) => x.condition === 'driver_liveness');
    expect(driver).to.have.length(2);
    expect(driver.map((x) => x.key)).to.deep.equal(['driver_liveness:m9-endurance', 'driver_liveness:other']);
  });
});

describe('filterFireOnce — one email per condition per window', () => {
  const alert: Alert = { condition: 'row_growth', key: 'row_growth', severity: 'critical', title: 't', detail: 'd' };
  const WINDOW = 3_600_000; // 1h

  it('first occurrence sends; a repeat within the window does NOT', () => {
    const first = filterFireOnce([alert], {}, 1_000, WINDOW);
    expect(first.toSend).to.have.length(1);
    // 30 min later, same condition still firing → suppressed
    const second = filterFireOnce([alert], first.nextState, 1_000 + 1_800_000, WINDOW);
    expect(second.toSend).to.have.length(0);
    expect(second.nextState.row_growth).to.equal(1_000); // unchanged
  });

  it('the same condition fires again AFTER the window elapses', () => {
    const first = filterFireOnce([alert], {}, 1_000, WINDOW);
    const later = filterFireOnce([alert], first.nextState, 1_000 + WINDOW + 1, WINDOW);
    expect(later.toSend).to.have.length(1);
  });

  it('distinct driver keys de-dupe independently', () => {
    const a: Alert = { condition: 'driver_liveness', key: 'driver_liveness:x', severity: 'critical', title: 't', detail: 'd' };
    const b: Alert = { condition: 'driver_liveness', key: 'driver_liveness:y', severity: 'critical', title: 't', detail: 'd' };
    const r = filterFireOnce([a, b], { 'driver_liveness:x': 500 }, 500 + 100, WINDOW);
    expect(r.toSend.map((x) => x.key)).to.deep.equal(['driver_liveness:y']); // x suppressed, y sent
  });
});
