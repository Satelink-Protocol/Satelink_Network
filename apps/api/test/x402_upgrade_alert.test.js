import { expect } from 'chai';
import { alertX402UpgradeFailure, __internal } from '../src/monitoring/x402_upgrade_alert.js';

describe('x402_upgrade_alert (T-29: Discord alert, rate-limited 1/hour)', () => {
  let calls;
  let originalFetch;
  let originalWebhook;

  // alertX402UpgradeFailure fires the send and returns immediately (fire-and-
  // forget). A fixed setTimeout to observe it was flaky in the full suite (the
  // send hadn't run yet under load). Await the module's in-flight send promise
  // instead — fully deterministic, no timing race.
  const settle = () => __internal.lastSend();

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
    await settle();
    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal('https://discord.example/webhook');
    expect(calls[0].body.embeds[0].description).to.include('facilitator unreachable');
  });

  it('suppresses a second alert within the 1-hour cooldown, but does not throw', async () => {
    alertX402UpgradeFailure('first failure');
    await settle();
    alertX402UpgradeFailure('second failure, same hour'); // cooldown-suppressed: no send
    await settle();
    expect(calls).to.have.length(1); // only the first sent
  });

  it('never throws when DISCORD_WEBHOOK_URL is unset (fail-safe, matches the fail-open path it observes)', () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    expect(() => alertX402UpgradeFailure('no webhook configured')).to.not.throw();
  });

  it('never throws when fetch itself rejects', async () => {
    globalThis.fetch = async () => { throw new Error('network down'); };
    expect(() => alertX402UpgradeFailure('will fail to send')).to.not.throw();
    await settle();
  });
});
