import { expect } from 'chai';
import { ethers } from 'ethers';
import { DepositListener } from '../src/services/deposit_listener.js';
import { MIN_CONFIRMATIONS } from '../src/billing/deposit_validation.mjs';

// ── In-memory mock of the pg pool covering the listener's legacy-ledger SQL,
// creditService's canonical SQL, AND the persisted scan cursor (A2.9). SQL is
// matched by substring so the tests pin behavior, not text (same pattern as
// credit_service.test.js).
function makePool({ account = null } = {}) {
  const state = {
    account: account ? { ...account } : null,
    creditDeposits: [],           // rows: {tx_hash, block_number, chain_id}
    creditBalances: new Map(),    // wallet → balance
    apiDeposits: new Set(),       // canonical tx_hash idempotency
    canonicalCredits: [],         // {wallet, amount}
    failCanonicalWith: null,      // simulate unique-violation race
    scanCursor: new Map(),        // chain_id → last_scanned_block (persisted cursor)
  };

  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    // transaction control on the mock is a no-op
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };

    // ── persisted scan cursor (deposit_scan_cursor)
    if (s.startsWith('CREATE TABLE IF NOT EXISTS deposit_scan_cursor')) return { rows: [] };
    if (s.includes('SELECT last_scanned_block FROM deposit_scan_cursor')) {
      const b = state.scanCursor.get(params[0]);
      return { rows: b != null ? [{ last_scanned_block: b }] : [] };
    }
    if (s.includes('INSERT INTO deposit_scan_cursor')) {
      const [chainId, block] = params;
      const prev = state.scanCursor.get(chainId) ?? 0;
      state.scanCursor.set(chainId, Math.max(prev, block)); // GREATEST semantics
      return { rowCount: 1, rows: [] };
    }

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
const cursorOf = (pool, chainId = 137) => pool.state.scanCursor.get(chainId) ?? 0;

function makeListener(pool, { events = [], currentBlock = 100_000, opts = {}, contract = null } = {}) {
  const listener = new DepositListener(pool, silentLog, { chainId: 137, ...opts });
  listener.provider = { getBlockNumber: async () => (typeof currentBlock === 'function' ? currentBlock() : currentBlock) };
  listener.contract = contract || {
    async queryFilter(_name, from, to) {
      return events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
    },
  };
  // start() ensures the cursor table in production; simulate that here so the
  // persisted-cursor path (not just the in-memory fallback) is exercised.
  listener._cursorTableReady = true;
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
    // Cursor advanced exactly to the last confirmed block, never past it.
    expect(cursorOf(pool)).to.equal(head - MIN_CONFIRMATIONS);
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

  it('idempotent on replay — an overlapping re-scan of already-scanned blocks never double-credits', async () => {
    const head = 100_000;
    const ev1 = { args: [WALLET, usdt(4)], transactionHash: '0x' + 'a'.repeat(64), blockNumber: 99_000 };
    const pool = makePool({ account: FREE_ACCOUNT });
    const listener = makeListener(pool, { currentBlock: head, events: [ev1] });

    // First poll scans and credits ev1; the cursor now covers its block.
    await listener._pollOnce();
    expect(pool.state.creditDeposits).to.have.length(1);
    expect(pool.state.account.credits_usdt).to.equal(4);

    // Force an OVERLAPPING re-scan of the same range by rewinding BOTH the
    // persisted cursor and the in-memory mirror (a real listener never rewinds
    // like this; this directly proves per-event tx_hash idempotency —
    // credit_deposits UNIQUE + api_deposits UNIQUE — is what prevents a double
    // credit, independent of cursor math).
    pool.state.scanCursor.set(137, 0);
    listener._lastScanned = 0;
    const dbCursorSpy = listener._dbCursor.bind(listener);
    listener._dbCursor = async () => 0; // pretend we have no cursor at all
    await listener._pollOnce();
    listener._dbCursor = dbCursorSpy;

    expect(pool.state.creditDeposits).to.have.length(1); // still exactly one row
    expect(pool.state.account.credits_usdt).to.equal(4); // NOT double-credited to 8
  });

  // ────────────────────────────────────────────────────────────────────────
  // A2.9 — bounded catch-up: the cursor NEVER advances past an unscanned block
  // ────────────────────────────────────────────────────────────────────────

  it('bounded catch-up over a MULTI-MILLION-block gap — never skips, credits the deep deposit', async () => {
    const pool = makePool({ account: FREE_ACCOUNT });
    // Deliberately behind by ~5M blocks. A per-poll ceiling means many polls,
    // never a single jump that skips the gap.
    pool.state.scanCursor.set(137, 1);
    const head = 5_000_000 + MIN_CONFIRMATIONS;
    const toBlock = head - MIN_CONFIRMATIONS; // 5_000_000
    const deepDeposit = {
      args: [WALLET, usdt(7)], transactionHash: '0x' + 'e'.repeat(64), blockNumber: 2_500_000,
    };
    const listener = makeListener(pool, {
      currentBlock: head,
      events: [deepDeposit],
      opts: { maxBlocksPerPoll: 500_000, logChunk: 500_000 },
    });

    const cursors = [];
    let polls = 0;
    while (cursorOf(pool) < toBlock && polls < 50) {
      const before = cursorOf(pool);
      await listener._pollOnce();
      const after = cursorOf(pool);
      cursors.push(after);
      // Each poll advances by AT MOST the per-poll ceiling — never a skip.
      expect(after - before).to.be.at.most(500_000);
      expect(after).to.be.greaterThan(before); // always makes forward progress
      polls += 1;
    }

    expect(polls).to.be.greaterThan(1);               // proves it was bounded, not one jump
    expect(cursorOf(pool)).to.equal(toBlock);         // fully caught up
    expect(pool.state.creditDeposits).to.have.length(1);
    expect(pool.state.account.credits_usdt).to.equal(7); // deep deposit credited exactly once
  });

  it('env ceiling SMALLER than per-poll chain growth — falls behind but never skips a block', async () => {
    const pool = makePool({ account: FREE_ACCOUNT });
    // The chain grows 300 blocks between polls while we can only scan 100 —
    // lag grows, but the cursor still advances contiguously and nothing is lost.
    let head = 1_000_000;
    pool.state.scanCursor.set(137, 999_000);
    const dep = { args: [WALLET, usdt(2)], transactionHash: '0x' + 'f'.repeat(64), blockNumber: 999_150 };
    const listener = makeListener(pool, {
      currentBlock: () => head,
      events: [dep],
      opts: { maxBlocksPerPoll: 100, logChunk: 100 },
    });

    const deltas = [];
    for (let i = 0; i < 3; i++) {
      const before = cursorOf(pool);
      await listener._pollOnce();
      deltas.push(cursorOf(pool) - before);
      head += 300; // chain outruns the scanner
    }

    // Every poll advanced by exactly the ceiling — bounded, contiguous, no skip.
    expect(deltas).to.deep.equal([100, 100, 100]);
    // The deposit at 999_150 entered a scanned window on poll 2 and was credited.
    expect(pool.state.account.credits_usdt).to.equal(2);
    expect(pool.state.creditDeposits).to.have.length(1);
  });

  it('restart mid-catch-up — a fresh instance resumes from the persisted cursor, no re-skip, no re-scan-below', async () => {
    const pool = makePool({ account: FREE_ACCOUNT });
    pool.state.scanCursor.set(137, 100_000);
    const head = 103_000 + MIN_CONFIRMATIONS;

    // Run 1 does ONE bounded poll and "crashes" partway through catch-up.
    const run1 = makeListener(pool, {
      currentBlock: head, events: [],
      opts: { maxBlocksPerPoll: 1000, logChunk: 1000 },
    });
    await run1._pollOnce();
    const afterRun1 = cursorOf(pool);
    expect(afterRun1).to.equal(101_000); // scanned 100_001..101_000 only

    // Run 2 is a fresh instance on the SAME pool (restart). Its events include a
    // deposit BELOW the persisted cursor (already-scanned) and one ABOVE it.
    const below = { args: [WALLET, usdt(9)], transactionHash: '0x' + '1'.repeat(63) + '2', blockNumber: 100_500 };
    const above = { args: [WALLET, usdt(3)], transactionHash: '0x' + '3'.repeat(63) + '4', blockNumber: 101_500 };
    const run2 = makeListener(pool, {
      currentBlock: head, events: [below, above],
      opts: { maxBlocksPerPoll: 1000, logChunk: 1000 },
    });
    await run2._pollOnce();

    // Resumed at 101_001: the below-cursor deposit is NOT re-scanned (trusted
    // scanned), the above-cursor deposit IS credited. Nothing skipped.
    expect(pool.state.creditDeposits.map((d) => d.block_number)).to.deep.equal([101_500]);
    expect(pool.state.account.credits_usdt).to.equal(3);
    expect(cursorOf(pool)).to.equal(102_000);
  });

  it('RPC error mid-chunk — the cursor does NOT advance past the failed chunk; the next poll re-scans it', async () => {
    const pool = makePool({ account: FREE_ACCOUNT });
    pool.state.scanCursor.set(137, 200_000);
    const head = 201_000 + MIN_CONFIRMATIONS;

    let failNextChunk = true;
    const dep = { args: [WALLET, usdt(6)], transactionHash: '0x' + '9'.repeat(64), blockNumber: 200_750 };
    const contract = {
      async queryFilter(_name, from, to) {
        // Fail on the SECOND chunk (200_501..201_000) on the first poll only.
        if (failNextChunk && from >= 200_501) {
          throw new Error('RPC 429: rate limited mid-chunk');
        }
        return [dep].filter((e) => e.blockNumber >= from && e.blockNumber <= to);
      },
    };
    const listener = makeListener(pool, {
      currentBlock: head, contract,
      opts: { maxBlocksPerPoll: 5000, logChunk: 500 },
    });

    // _pollSafe swallows the throw (retries next interval). Chunk 1 scanned and
    // committed the cursor; chunk 2 threw BEFORE advancing the cursor.
    await listener._pollSafe();
    expect(cursorOf(pool)).to.equal(200_500);          // did NOT jump to 201_000
    expect(pool.state.creditDeposits).to.have.length(0); // deposit was in the failed chunk

    // RPC recovers; the next poll re-scans exactly the un-advanced range.
    failNextChunk = false;
    await listener._pollSafe();
    expect(cursorOf(pool)).to.equal(201_000);
    expect(pool.state.creditDeposits.map((d) => d.block_number)).to.deep.equal([200_750]);
    expect(pool.state.account.credits_usdt).to.equal(6); // credited exactly once, never lost
  });
});
