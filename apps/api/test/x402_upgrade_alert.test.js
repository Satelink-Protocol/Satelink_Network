import { expect } from 'chai';
import { alertX402UpgradeFailure, __internal } from '../src/monitoring/x402_upgrade_alert.js';

describe('x402_upgrade_alert (T-29: Discord alert, rate-limited 1/hour)', () => {
  let calls;
  let originalFetch;
  let originalWebhook;

  // alertX402UpgradeFailure fires the fetch and returns immediately (fire-and-
  // forget). A fixed `setTimeout(10)` was long enough in isolation but flaky in
  // the full suite: under load the microtask that pushes to `calls` hadn't run
  // in 10ms, so `calls` was empty and this file showed up as a NEW baseline
  // failure. Poll for the expected count instead — deterministic regardless of
  // how busy the event loop is.
  async function waitForCalls(n, timeoutMs = 1000) {
    const start = Date.now();
    while (calls.length < n && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return calls.length;
  }

  beforeEach(() => {
    __internal.reset();
    calls = [];
    originalFetch = globalThis.fetch;
    originalWebhook = process.env.DISCORD_WEBHOOK_URL;
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.example/webhook';
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWebhook === undefined) delete process.env.DISCORD_WEBHOOK_URL;
    else process.env.DISCORD_WEBHOOK_URL = originalWebhook;
  });

  it('sends a Discord alert on the first failure', async () => {
    alertX402UpgradeFailure('facilitator unreachable');
    await waitForCalls(1);
    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal('https://discord.example/webhook');
    expect(calls[0].body.embeds[0].description).to.include('facilitator unreachable');
  });

  it('suppresses a second alert within the 1-hour cooldown, but does not throw', async () => {
    alertX402UpgradeFailure('first failure');
    await waitForCalls(1);
    alertX402UpgradeFailure('second failure, same hour');
    // The second is cooldown-suppressed, so no call to wait for — give the
    // event loop a couple of ticks to prove nothing else fired, then assert.
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).to.have.length(1); // only the first sent
  });

  it('never throws when DISCORD_WEBHOOK_URL is unset (fail-safe, matches the fail-open path it observes)', () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    expect(() => alertX402UpgradeFailure('no webhook configured')).to.not.throw();
  });

  it('never throws when fetch itself rejects', async () => {
    globalThis.fetch = async () => { throw new Error('network down'); };
    expect(() => alertX402UpgradeFailure('will fail to send')).to.not.throw();
    await new Promise((r) => setTimeout(r, 10));
  });
});
