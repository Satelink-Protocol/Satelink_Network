import { expect } from 'chai';
import { ethers } from 'ethers';
import { DepositListener } from '../src/services/deposit_listener.js';
import { MIN_CONFIRMATIONS } from '../src/billing/deposit_validation.mjs';

// ── In-memory mock of the pg pool covering BOTH the listener's legacy-ledger
// SQL and creditService's canonical SQL. SQL is matched by substring so the
// tests pin behavior, not text (same pattern as credit_service.test.js).
function makePool({ account = null } = {}) {
  const state = {
    account: account ? { ...account } : null,
    creditDeposits: [],           // rows: {tx_hash, block_number, chain_id}
    creditBalances: new Map(),    // wallet → balance
    apiDeposits: new Set(),       // canonical tx_hash idempotency
    canonicalCredits: [],         // {wallet, amount}
    failCanonicalWith: null,      // simulate unique-violation race
  };

  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    // transaction control on the mock is a no-op
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };

    if (s.includes('SELECT COALESCE(MAX(block_number), 0)')) {
      const max = Math.max(0, ...state.creditDeposits.map((d) => d.block_number));
      return { rows: [{ cursor: max }] };
    }
    if (s.includes('SELECT id FROM credit_deposits WHERE tx_hash')) {
      return { rows: state.creditDeposits.filter((d) => d.tx_hash === params[0]).map((d, i) => ({ id: i + 1 })) };
    }
    if (s.includes('INSERT INTO credit_deposits')) {
      if (state.creditDeposits.some((d) => d.tx_hash === params[2])) {
        const err = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        throw err;
      }
      state.creditDeposits.push({ wallet: params[0], amount: params[1], tx_hash: params[2], block_number: params[3], chain_id: params[4] });
      return { rowCount: 1, rows: [] };
    }
    if (s.includes('INSERT INTO credit_balances')) {
      const prev = state.creditBalances.get(params[0]) || 0;
      state.creditBalances.set(params[0], +(prev + parseFloat(params[1])).toFixed(6));
      return { rowCount: 1, rows: [] };
    }

    // ── canonical (creditService) SQL
    if (s.startsWith('SELECT api_key, wallet_address') && s.includes('wallet_address')) {
      const w = String(params[0]).toLowerCase();
      return {
        rows:
          state.account && String(state.account.wallet_address).toLowerCase() === w
            ? [state.account]
            : [],
      };
    }
    if (s.includes('SELECT 1 FROM api_deposits WHERE tx_hash')) {
      return { rows: state.apiDeposits.has(params[0]) ? [{ '?column?': 1 }] : [] };
    }
    if (s.includes('INSERT INTO api_deposits')) {
      if (state.failCanonicalWith) throw state.failCanonicalWith;
      state.apiDeposits.add(params[1]);
      return { rowCount: 1, rows: [] };
    }
    if (s.startsWith('UPDATE api_credits') && s.includes('total_deposited')) {
      state.account.credits_usdt = +((state.account.credits_usdt || 0) + params[0]).toFixed(6);
      if (params[1]) state.account.tier = params[1];
      if (params[2]) state.account.daily_limit = params[2];
      state.canonicalCredits.push({ amount: params[0] });
      return { rowCount: 1, rows: [{ credits_usdt: state.account.credits_usdt, tier: state.account.tier, daily_limit: state.account.daily_limit }] };
    }
    throw new Error('unexpected SQL: ' + s);
  }

  return { state, query };
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };
const WALLET = '0xaaa0000000000000000000000000000000000001';
const FREE_ACCOUNT = {
  api_key: 'sk_free_' + 'a'.repeat(48),
  wallet_address: WALLET,
  tier: 'free',
  daily_limit: 500,
  credits_usdt: 0,
  status: 'active',
};

const usdt = (n) => ethers.parseUnits(String(n), 6);

function makeListener(pool, { events = [], currentBlock = 100_000 } = {}) {
  const listener = new DepositListener(pool, silentLog, { chainId: 137 });
  listener.provider = { getBlockNumber: async () => currentBlock };
  listener.contract = {
    async queryFilter(_name, from, to) {
      return events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
    },
  };
  listener.running = true;
  return listener;
}

describe('DepositListener — canonical crediting + hardening', () => {
  it('credits the CANONICAL store for a registered wallet and upgrades free → basic (T-22: exactly one spendable store)', async () => {
    const pool = makePool({ account: FREE_ACCOUNT });
    const listener = makeListener(pool);

    const ok = await listener._handleDeposit(WALLET, usdt(5), '0x' + '1'.repeat(64), 50_000, 137);

    expect(ok).to.equal(true);
    expect(pool.state.creditBalances.size).to.equal(0);                 // legacy ledger — never written
    expect(pool.state.account.credits_usdt).to.equal(5);                // CANONICAL api_credits
    expect(pool.state.account.tier).to.equal('basic');                  // spendable tier
    expect(pool.state.account.daily_limit).to.equal(10000);
  });

  it('duplicate deposit tx credits exactly once', async () => {
    const pool = makePool({ account: FREE_ACCOUNT });
    const listener = makeListener(pool);
    const tx = '0x' + '2'.repeat(64);

    const first = await listener._handleDeposit(WALLET, usdt(1), tx, 50_000, 137);
    const second = await listener._handleDeposit(WALLET, usdt(1), tx, 50_000, 137);

    expect(first).to.equal(true);
    expect(second).to.equal(false);
    expect(pool.state.account.credits_usdt).to.equal(1);
    expect(pool.state.creditDeposits).to.have.length(1);
  });

  it('deposit from an UNREGISTERED wallet is recorded (idempotency only) but credited nowhere (T-22)', async () => {
    const pool = makePool({ account: null });
    const listener = makeListener(pool);

    const ok = await listener._handleDeposit(WALLET, usdt(2), '0x' + '3'.repeat(64), 50_000, 137);

    expect(ok).to.equal(true);
    expect(pool.state.creditDeposits).to.have.length(1);    // scan idempotency only
    expect(pool.state.creditBalances.size).to.equal(0);     // legacy ledger — never written
    expect(pool.state.canonicalCredits).to.have.length(0);  // no api_credits touch
    // Registering the wallet and calling POST /api/keys/deposit with this
    // tx_hash re-verifies on-chain and credits it then — nothing is lost.
  });

  it('below-minimum deposit credits canonically but does NOT upgrade the tier', async () => {
    const pool = makePool({ account: FREE_ACCOUNT });
    const listener = makeListener(pool);

    await listener._handleDeposit(WALLET, usdt(0.10), '0x' + '4'.repeat(64), 50_000, 137);

    expect(pool.state.account.credits_usdt).to.equal(0.1);
    expect(pool.state.account.tier).to.equal('free');
  });

  it('survives a canonical-credit race (unique violation from the claim route)', async () => {
    const pool = makePool({ account: FREE_ACCOUNT });
    const raceErr = new Error('duplicate key value violates unique constraint "api_deposits_tx_hash_key"');
    raceErr.code = '23505';
    pool.state.failCanonicalWith = raceErr;
    const listener = makeListener(pool);

    // Must not throw, and the scan-idempotency entry still lands.
    const ok = await listener._handleDeposit(WALLET, usdt(1), '0x' + '5'.repeat(64), 50_000, 137);
    expect(ok).to.equal(true);
    expect(pool.state.creditDeposits).to.have.length(1);
    expect(pool.state.canonicalCredits).to.have.length(0);
  });

  it('scans only confirmed blocks (toBlock = head - MIN_CONFIRMATIONS)', async () => {
    const head = 100_000;
    const confirmedBlock = head - MIN_CONFIRMATIONS - 1;
    const unconfirmedBlock = head - 1; // too shallow — must NOT be credited yet
    const pool = makePool({ account: FREE_ACCOUNT });
    const listener = makeListener(pool, {
      currentBlock: head,
      events: [
        { args: [WALLET, usdt(1)], transactionHash: '0x' + '6'.repeat(64), blockNumber: confirmedBlock },
        { args: [WALLET, usdt(9)], transactionHash: '0x' + '7'.repeat(64), blockNumber: unconfirmedBlock },
      ],
    });

    await listener._pollOnce();

    expect(pool.state.creditDeposits.map((d) => d.tx_hash)).to.deep.equal(['0x' + '6'.repeat(64)]);
    expect(pool.state.account.credits_usdt).to.equal(1);
  });

  it('restart mid-block-range resumes from the DB cursor (no gap, no rescan-credit)', async () => {
    const head = 100_000;
    // Blocks must sit inside the initial-lookback window (head - conf - 10k).
    const ev1 = { args: [WALLET, usdt(1)], transactionHash: '0x' + '8'.repeat(64), blockNumber: 95_000 };
    const ev2 = { args: [WALLET, usdt(2)], transactionHash: '0x' + '9'.repeat(64), blockNumber: 95_500 };

    // First run credits ev1 then "crashes" before seeing ev2.
    const pool = makePool({ account: FREE_ACCOUNT });
    const run1 = makeListener(pool, { currentBlock: head, events: [ev1] });
    await run1._pollOnce();
    expect(pool.state.creditDeposits).to.have.length(1);

    // Fresh listener instance (restart) with the SAME pool: cursor = 60,000 →
    // scan resumes at 60,001 and picks up ev2 exactly once.
    const run2 = makeListener(pool, { currentBlock: head + 10, events: [ev1, ev2] });
    await run2._pollOnce();

    const hashes = pool.state.creditDeposits.map((d) => d.tx_hash);
    expect(hashes).to.deep.equal(['0x' + '8'.repeat(64), '0x' + '9'.repeat(64)]);
    expect(pool.state.account.credits_usdt).to.equal(3); // 1 + 2, nothing double-credited
  });

  it('duplicate block processing stays idempotent — an overlapping re-scan never double-credits', async () => {
    const head = 100_000;
    const ev1 = { args: [WALLET, usdt(4)], transactionHash: '0x' + 'a'.repeat(64), blockNumber: 99_000 };
    const pool = makePool({ account: FREE_ACCOUNT });
    const listener = makeListener(pool, { currentBlock: head, events: [ev1] });

    // First poll scans and credits ev1; the cursor now covers its block.
    await listener._pollOnce();
    expect(pool.state.creditDeposits).to.have.length(1);
    expect(pool.state.account.credits_usdt).to.equal(4);

    // Force an OVERLAPPING re-scan of the same range (simulates two chunks —
    // or two poll cycles — whose windows legitimately overlap at the edges).
    // The DB cursor still reflects ev1's block, so a real listener would never
    // naturally rewind like this; this directly proves the per-event
    // tx_hash idempotency (credit_deposits UNIQUE + api_deposits UNIQUE) is
    // what actually prevents a double credit, independent of cursor math.
    listener._lastScanned = 0;
    const dbCursorSpy = listener._dbCursor.bind(listener);
    listener._dbCursor = async () => 0; // pretend we have no cursor at all
    await listener._pollOnce();
    listener._dbCursor = dbCursorSpy;

    expect(pool.state.creditDeposits).to.have.length(1); // still exactly one row
    expect(pool.state.account.credits_usdt).to.equal(4); // NOT double-credited to 8
  });

  it('reorg-safe confirmation depth — a shallow event is deferred, then credited exactly once at depth', async () => {
    const ev = { args: [WALLET, usdt(3)], transactionHash: '0x' + 'b'.repeat(64), blockNumber: 99_990 };
    const pool = makePool({ account: FREE_ACCOUNT });

    // Poll while the event is still shallower than MIN_CONFIRMATIONS — a reorg
    // could still drop it, so it must NOT be credited yet.
    const shallowHead = 99_990 + MIN_CONFIRMATIONS - 1; // one block short of confirmed
    const shallowListener = makeListener(pool, { currentBlock: shallowHead, events: [ev] });
    await shallowListener._pollOnce();
    expect(pool.state.creditDeposits).to.have.length(0);
    expect(pool.state.account.credits_usdt).to.equal(0);

    // Chain advances past confirmation depth (the tx survived — no reorg
    // dropped it): a fresh listener instance (simulating the next poll cycle,
    // or a restart) now credits it, exactly once.
    const confirmedHead = 99_990 + MIN_CONFIRMATIONS;
    const confirmedListener = makeListener(pool, { currentBlock: confirmedHead, events: [ev] });
    await confirmedListener._pollOnce();
    expect(pool.state.creditDeposits.map((d) => d.tx_hash)).to.deep.equal(['0x' + 'b'.repeat(64)]);
    expect(pool.state.account.credits_usdt).to.equal(3);

    // One more poll (e.g. the process never restarted) must not re-credit it.
    await confirmedListener._pollOnce();
    expect(pool.state.creditDeposits).to.have.length(1);
    expect(pool.state.account.credits_usdt).to.equal(3);
  });

  it('missed-block backfill — a gap beyond maxLookbackBlocks is logged loudly, never silently dropped', async () => {
    const errors = [];
    const loudLog = { info() {}, warn() {}, error: (msg) => errors.push(msg), debug() {} };
    const ev1 = { args: [WALLET, usdt(1)], transactionHash: '0x' + 'c'.repeat(64), blockNumber: 50_000 };
    const pool = makePool({ account: FREE_ACCOUNT });

    // Establish a real DB cursor at block 50,000.
    const run1 = makeListener(pool, { currentBlock: 50_025 + MIN_CONFIRMATIONS, events: [ev1] });
    run1.log = loudLog;
    await run1._pollOnce();
    expect(pool.state.creditDeposits).to.have.length(1);

    // "Restart" after being down far longer than maxLookbackBlocks worth of
    // blocks (default 50_000) — an extreme, deliberately-out-of-band gap.
    const ev2 = { args: [WALLET, usdt(2)], transactionHash: '0x' + 'd'.repeat(64), blockNumber: 50_100 };
    const run2 = makeListener(pool, { currentBlock: 50_025 + MIN_CONFIRMATIONS + 200_000, events: [ev1, ev2] });
    run2.log = loudLog;
    await run2._pollOnce();

    // ev2 sits inside the skipped gap — NOT auto-credited (the safety cap is
    // still real and still bounds a single poll's range) — but the skip must
    // be loudly, specifically logged, not silent.
    const gapLog = errors.find((m) => m.includes('GAP SKIPPED'));
    expect(gapLog, 'a GAP SKIPPED error must be logged').to.exist;
    expect(gapLog).to.include('50001'); // first skipped block
    expect(pool.state.account.credits_usdt).to.equal(1); // ev2 not credited (recoverable via manual claim)
  });
});
