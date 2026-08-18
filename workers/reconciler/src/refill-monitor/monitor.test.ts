/**
 * Unit tests for the refill monitor — validates transition detection, event
 * emission, and edge cases (no schedules, all consumed, gap skip).
 *
 * Uses a mock Queryable that returns canned query results, so these tests
 * run without Postgres (fast, CI-safe).
 */

import { describe, it, expect, vi } from 'vitest';
import { monitorSchedules } from './monitor.js';

/** Minimal mock Queryable that maps SQL substrings to canned results. */
function mockQueryable(handlers: Array<{ match: string; result: { rows: unknown[]; rowCount?: number } }>) {
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      for (const h of handlers) {
        if (sql.includes(h.match)) return { rowCount: h.result.rowCount ?? 0, ...h.result };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('monitorSchedules', () => {
  it('returns zeros when no schedules exist', async () => {
    const db = mockQueryable([
      { match: 'json_agg', result: { rows: [] } },
    ]);
    const result = await monitorSchedules(db as never, new Date());
    expect(result.schedulesChecked).toBe(0);
    expect(result.transitionsDetected).toBe(0);
    expect(result.eventsEmitted).toBe(0);
  });

  it('detects a transition when current auth differs from previous', async () => {
    const auths = JSON.stringify([
      { id: 'auth_1', cap_amount: '100', consumed_amount: '100', state: 'active' },
      { id: 'auth_2', cap_amount: '100', consumed_amount: '30', state: 'active' },
      { id: 'auth_3', cap_amount: '100', consumed_amount: '0', state: 'active' },
    ]);

    const db = mockQueryable([
      // Schedule query
      {
        match: 'json_agg',
        result: {
          rows: [{ schedule_id: 'sched_test', principal_id: 'prn_test', auths }],
        },
      },
      // Previous state: auth_1 was current
      { match: 'schedule_state', result: { rows: [{ current_auth_id: 'auth_1' }] } },
      // Outbox insert (nonce_transition)
      { match: 'INSERT INTO outbox', result: { rows: [], rowCount: 1 } },
      // Schedule state upsert
      { match: 'INSERT INTO schedule_state', result: { rows: [], rowCount: 1 } },
    ]);

    const result = await monitorSchedules(db as never, new Date());
    expect(result.schedulesChecked).toBe(1);
    expect(result.transitionsDetected).toBe(1);
    expect(result.eventsEmitted).toBeGreaterThanOrEqual(1);

    // Verify the outbox insert was called with the transition event.
    const outboxCalls = db.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO outbox'),
    );
    expect(outboxCalls.length).toBeGreaterThanOrEqual(1);
    const eventParams = outboxCalls[0]![1] as string[];
    expect(eventParams[0]).toContain('nonce_transition');
    expect(eventParams[1]).toBe('authorization.nonce_transition');
  });

  it('does not emit transition when current auth matches previous', async () => {
    const auths = JSON.stringify([
      { id: 'auth_1', cap_amount: '100', consumed_amount: '50', state: 'active' },
      { id: 'auth_2', cap_amount: '100', consumed_amount: '0', state: 'active' },
    ]);

    const db = mockQueryable([
      {
        match: 'json_agg',
        result: {
          rows: [{ schedule_id: 'sched_test', principal_id: 'prn_test', auths }],
        },
      },
      { match: 'schedule_state', result: { rows: [{ current_auth_id: 'auth_1' }] } },
      { match: 'INSERT INTO schedule_state', result: { rows: [], rowCount: 1 } },
    ]);

    const result = await monitorSchedules(db as never, new Date());
    expect(result.transitionsDetected).toBe(0);

    // No outbox insert for nonce_transition.
    const outboxCalls = db.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO outbox'),
    );
    expect(outboxCalls.length).toBe(0);
  });

  it('emits schedule_exhausted when all auths are consumed', async () => {
    const auths = JSON.stringify([
      { id: 'auth_1', cap_amount: '100', consumed_amount: '100', state: 'active' },
      { id: 'auth_2', cap_amount: '100', consumed_amount: '100', state: 'active' },
    ]);

    const db = mockQueryable([
      {
        match: 'json_agg',
        result: {
          rows: [{ schedule_id: 'sched_test', principal_id: 'prn_test', auths }],
        },
      },
      { match: 'schedule_state', result: { rows: [{ current_auth_id: 'auth_2' }] } },
      { match: 'INSERT INTO outbox', result: { rows: [], rowCount: 1 } },
    ]);

    const result = await monitorSchedules(db as never, new Date());

    // Should emit schedule_exhausted.
    const outboxCalls = db.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO outbox'),
    );
    const exhaustedCall = outboxCalls.find((c) => {
      const params = c[1] as string[];
      return params[1] === 'authorization.schedule_exhausted';
    });
    expect(exhaustedCall).toBeDefined();
    expect(result.eventsEmitted).toBeGreaterThanOrEqual(1);
  });

  it('emits schedule_low when only 1 nonce remaining', async () => {
    const auths = JSON.stringify([
      { id: 'auth_1', cap_amount: '100', consumed_amount: '100', state: 'active' },
      { id: 'auth_2', cap_amount: '100', consumed_amount: '100', state: 'active' },
      { id: 'auth_3', cap_amount: '100', consumed_amount: '10', state: 'active' },
    ]);

    const db = mockQueryable([
      {
        match: 'json_agg',
        result: {
          rows: [{ schedule_id: 'sched_test', principal_id: 'prn_test', auths }],
        },
      },
      { match: 'schedule_state', result: { rows: [{ current_auth_id: 'auth_3' }] } },
      { match: 'INSERT INTO outbox', result: { rows: [], rowCount: 1 } },
      { match: 'INSERT INTO schedule_state', result: { rows: [], rowCount: 1 } },
    ]);

    const result = await monitorSchedules(db as never, new Date());

    const outboxCalls = db.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO outbox'),
    );
    const lowCall = outboxCalls.find((c) => {
      const params = c[1] as string[];
      return params[1] === 'authorization.schedule_low';
    });
    expect(lowCall).toBeDefined();
    expect(result.eventsEmitted).toBeGreaterThanOrEqual(1);
  });
});
