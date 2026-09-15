// apps/api/src/payments/x402/middleware.js
// x402 v2 parallel payment rail for /rpc (feature-flagged, default OFF).
//
// Two jobs, both scoped to the exact code path where the gateway returns its
// custom 402 today (no key + free tier exhausted, free_tier_gate.js):
//
//  1. No payment header → let the request flow through untouched; if any
//     downstream ANONYMOUS 402 is emitted (free-tier exhausted, subnet cap,
//     or the gateway's keyless payment-required), upgrade that response to a
//     spec-compliant x402 402 (PAYMENT-REQUIRED header + accepts in the JSON
//     body) with the original USDT deposit body preserved under
//     "alternativePayment" so the existing human/vault rail survives.
//     Keyed/wallet callers' 402s are never touched.
//  2. x402 payment header present → facilitator verify + settle via the SDK
//     (no hand-rolled crypto), record the settlement (payment_sources +
//     revenue_events_v2 in one transaction, tx_hash UNIQUE → 409 on replay),
//     then mark req.x402.settled so the wiring in app_factory lets the call
//     through without consuming free-tier quota.
//
// When X402_ENABLED != 'true' this middleware is a bare next() — no response
// wrapping, no SDK objects built — so gateway behavior is byte-identical.

// Ensure globalThis.crypto (WebCrypto) exists BEFORE @coinbase/x402 is loaded —
// on Node 18 it is otherwise undefined and CDP Ed25519 JWT signing throws
// "crypto is not defined", killing facilitator sync (T-04 layer 2). Side-effect
// import; must precede the @coinbase/x402 / @x402 imports below.
import '../../bootstrap/webcrypto_global.js';
import { ExpressAdapter } from '@x402/express';
import { x402ResourceServer, x402HTTPResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { createCdpAuthHeaders } from '@coinbase/x402';
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
  validateBazaarRouteExtensions,
} from '@x402/extensions/bazaar';
import { getX402Config } from './config.js';
import { recordX402Settlement, DuplicateSettlementError } from './settlement.js';
import { bumpFunnel, bumpFunnelDaily } from './funnel.js';

const LOG_PREFIX = '[x402]';
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// ── Facilitator abuse guard ─────────────────────────────────────────────────
// Payment-bearing requests bypass the free-tier gate by design, so they need
// their own pre-facilitator screen: size cap, shape check, and a per-IP
// fixed-window rate limit — a forged-payment flood must not translate 1:1
// into CDP verify calls.
const MAX_PAYMENT_HEADER_BYTES = parseInt(process.env.X402_MAX_PAYMENT_HEADER_BYTES || '8192');
const VERIFY_MAX_PER_WINDOW = parseInt(process.env.X402_VERIFY_MAX_PER_MIN || '30');
const VERIFY_WINDOW_MS = 60_000;
const VERIFY_MAP_MAX = 10_000; // same OOM cap pattern as free_tier_gate's ipCounters
const verifyWindows = new Map(); // ip -> { count, resetAt }

function verifyRateLimited(ip) {
  const now = Date.now();
  let win = verifyWindows.get(ip);
  if (!win || now >= win.resetAt) {
    if (!win && verifyWindows.size >= VERIFY_MAP_MAX) {
      verifyWindows.delete(verifyWindows.keys().next().value);
    }
    win = { count: 0, resetAt: now + VERIFY_WINDOW_MS };
    verifyWindows.set(ip, win);
  }
  win.count++;
  return win.count > VERIFY_MAX_PER_WINDOW;
}

// Cheap structural screen before any facilitator traffic: the header must be
// base64 of a JSON object carrying a numeric x402Version. This is NOT payment
// verification (the facilitator owns that) — it only rejects garbage that
// could never verify, without a network call.
function paymentHeaderLooksStructural(header) {
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)
      && typeof decoded.x402Version === 'number';
  } catch {
    return false;
  }
}

function clientIpOf(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// /rpc is a machine endpoint — always negotiate JSON, never the HTML paywall.
class JsonAdapter extends ExpressAdapter {
  getAcceptHeader() {
    return 'application/json';
  }
}

function buildHttpServer(cfg) {
  const facilitatorClient = new HTTPFacilitatorClient({
    url: cfg.facilitatorUrl,
    createAuthHeaders: createCdpAuthHeaders(),
  });
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(cfg.network, new ExactEvmScheme());
  resourceServer.registerExtension(bazaarResourceServerExtension);

  const routeConfig = {
    accepts: {
      scheme: 'exact',
      price: `$${cfg.bundlePriceUsd}`,
      network: cfg.network,
      payTo: cfg.payTo,
      maxTimeoutSeconds: 60,
    },
    // Method-level description so the Bazaar catalog reads as a full-capability
    // RPC (agents + semantic search match on method names). Mirrors how indexed
    // peers enumerate their surface instead of a single opaque endpoint.
    description:
      `Satelink — Polygon PoS (chain 137) JSON-RPC. Pay-per-call access to the full ` +
      `standard method set: eth_call, eth_getBalance, eth_blockNumber, eth_getLogs, ` +
      `eth_getTransactionReceipt, eth_getTransactionByHash, eth_sendRawTransaction, ` +
      `eth_getCode, eth_estimateGas, eth_getStorageAt, and every other JSON-RPC method. ` +
      `Send any request in the POST body. $${cfg.bundlePriceUsd} = ${cfg.bundleCalls.toLocaleString('en-US')} calls ` +
      `(USDC on Base via x402); permissionless, no account, no commitment.`,
    mimeType: 'application/json',
    // The serving endpoint is POST /rpc/:chain (bare POST /rpc has no handler),
    // so discovery/catalog metadata must point at a URL that actually serves.
    resource: `${process.env.API_BASE_URL || 'https://rpc.satelink.network'}/rpc/polygon`,
    // Bazaar discovery — indexed into the CDP catalog once the facilitator
    // sees the declared extension on a settled payment.
    extensions: declareDiscoveryExtension({
      method: 'POST',
      bodyType: 'json',
      input: { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 },
      inputSchema: {
        properties: {
          jsonrpc: { type: 'string' },
          method: { type: 'string' },
          params: { type: 'array' },
          id: { type: ['number', 'string'] },
        },
        required: ['jsonrpc', 'method'],
      },
      output: { example: { jsonrpc: '2.0', id: 1, result: '0x4523a9' } },
    }),
  };
  // Discovery metadata lives ONLY on the concrete /rpc/polygon route so the
  // Bazaar catalogs a working URL (a wildcard route template indexed as
  // /rpc/:var1 — verified in the live catalog 2026-07-10). Payment stays
  // accepted on every /rpc path via the extension-less entries below;
  // first-match wins, so the explicit route is declared first.
  const { extensions, ...payableOnly } = routeConfig;
  const routes = {
    'POST /rpc/polygon': routeConfig,
    'POST /rpc': payableOnly,
    'POST /rpc/*': payableOnly,
  };
  validateBazaarRouteExtensions(routes);
  return new x402HTTPResourceServer(resourceServer, routes);
}

// Record a settled payment (payment_sources + revenue event + bundle credit,
// one transaction); on a replayed settlement id send 409 and report
// not-served. Returns the settlement result ({creditedKey, balanceAfter,
// callsRemaining}) on success, false when a response was already sent.
// Exported so tests can drive the duplicate path against the real UNIQUE
// constraint without faking a facilitator.
export async function recordSettlementOrReject(pool, res, params, log = console) {
  try {
    return await recordX402Settlement(pool, params);
  } catch (err) {
    if (err instanceof DuplicateSettlementError) {
      log.warn(`${LOG_PREFIX} duplicate settlement rejected: ${err.txHash}`);
      res.status(409).json({
        ok: false,
        error: 'duplicate_settlement',
        message: 'This x402 settlement was already redeemed for a call.',
        tx_hash: err.txHash,
      });
      return false;
    }
    log.error(`${LOG_PREFIX} settlement record failed: ${err.message}`);
    res.status(500).json({ ok: false, error: 'settlement_record_failed' });
    return false;
  }
}

function writeSdkResponse(res, response) {
  res.status(response.status);
  for (const [key, value] of Object.entries(response.headers || {})) res.setHeader(key, value);
  if (response.isHtml) return res.send(response.body);
  return res.json(response.body || {});
}

// Egress trim (2026-08-10): the anonymous x402 402 embeds the legacy USDT-rail
// body under `alternativePayment` so a machine that prefers the vault/USDT rail
// over x402/USDC still has the essentials. That legacy body is ~4.1 KB — mostly
// human-readable curl `examples`, a verbose `register` block, deposit prose, and
// fields duplicated inside `error.data.payment`. The x402 client never reads
// `alternativePayment` (verified against @x402/core@2.17.0 createPaymentPayload,
// dist/cjs/client/index.js:257-303 — it reads only x402Version/accepts/
// extensions/resource), so trimming it does not touch the payment path. We keep
// the machine-actionable USDT fields (where to deposit, the token, chain,
// minimum, calldata endpoint, how to get a key) plus the JSON-RPC `error`
// envelope verbatim (RPC clients parse error.code -32005) and drop the ~3.4 KB
// of prose/duplication — one docs fetch away. Served ~1.19M×/day.
export function compactAlternativePayment(body) {
  if (!body || typeof body !== 'object') return body;
  const d = body.deposit || {};
  const compact = {
    // Verbatim: preserves the -32005 JSON-RPC error envelope RPC clients read,
    // and whatever shape it carries (object with .data on the per-IP 402, or the
    // 'payment_required' string on the keyless 402).
    error: body.error,
    deposit: {
      vault_address: d.vault_address,
      usdt_contract: d.usdt_contract,
      chain_id: d.chain_id,
      minimum_usdt: d.minimum_usdt,
      calldata_url: d.calldata_url,
    },
    register_url: body.register_url,
    docs: body.docs,
  };
  return compact;
}

export function createX402Middleware(pool, logger) {
  const log = logger || console;
  let httpServer = null;
  let initPromise = null;

  function getServer(cfg) {
    if (!httpServer) httpServer = buildHttpServer(cfg);
    return httpServer;
  }

  // Facilitator sync (supported networks/schemes). Best-effort: CDP requires
  // auth even on /supported, so without CDP_API_KEY_* this 401s — but 402
  // generation uses locally-registered schemes and verify/settle fall back to
  // the configured facilitator client directly, so the rail still works.
  // Failures retry on a cooldown instead of hammering CDP on every 402.
  let initialized = false;
  let initFailedAt = 0;
  const INIT_RETRY_MS = 60_000;
  async function ensureInitialized(server) {
    if (initialized || Date.now() - initFailedAt < INIT_RETRY_MS) return;
    if (!initPromise) initPromise = server.initialize();
    try {
      await initPromise;
      initialized = true;
    } catch (err) {
      initPromise = null;
      initFailedAt = Date.now();
      log.warn(`${LOG_PREFIX} facilitator sync unavailable, continuing without: ${err.message}`);
    }
  }

  return async function x402Middleware(req, res, next) {
    const cfg = getX402Config();
    if (!cfg.enabled) return next();

    const path = (req.originalUrl || req.url).split('?')[0];
    const paymentHeader = req.header('payment-signature') || req.header('x-payment');

    // ---- Rail 2: an x402 payment is attached — verify, settle, serve ----
    if (paymentHeader) {
      bumpFunnel(pool, 'attempts');
      bumpFunnelDaily(pool, 'x_payment_retry_received'); // X-PAYMENT present on this request
      // Abuse guard: reject before any facilitator round-trip. The rate limit
      // counts every attempt (malformed included — that's the abuse) so a
      // flood can't probe shapes for free.
      if (paymentHeader.length > MAX_PAYMENT_HEADER_BYTES) {
        return res.status(400).json({ ok: false, error: 'x402_payment_header_too_large', max_bytes: MAX_PAYMENT_HEADER_BYTES });
      }
      if (verifyRateLimited(clientIpOf(req))) {
        res.set('Retry-After', '60');
        return res.status(429).json({ ok: false, error: 'x402_verify_rate_limited', message: `more than ${VERIFY_MAX_PER_WINDOW} payment attempts per minute from this IP` });
      }
      if (!paymentHeaderLooksStructural(paymentHeader)) {
        return res.status(400).json({ ok: false, error: 'x402_payment_malformed', message: 'payment header is not base64-encoded JSON with a numeric x402Version' });
      }

      let result;
      try {
        const server = getServer(cfg);
        await ensureInitialized(server);
        result = await server.processHTTPRequest({
          adapter: new JsonAdapter(req),
          path,
          method: req.method,
          paymentHeader,
        });
      } catch (err) {
        log.error(`${LOG_PREFIX} verify failed: ${err.message}`);
        return res.status(502).json({ ok: false, error: 'x402_facilitator_error', message: err.message });
      }

      if (result.type === 'no-payment-required') return next();
      if (result.type === 'payment-error') {
        // A payable x402 402 is re-served to a caller whose payment did not verify.
        if (result.response && result.response.status === 402) bumpFunnelDaily(pool, 'x402_402_served');
        return writeSdkResponse(res, result.response);
      }

      // payment-verified — settle BEFORE serving so an unsettled call is never
      // executed, then record. Duplicate settlement id → 409, call not served.
      let settle;
      try {
        settle = await httpServer.processSettlement(
          result.paymentPayload,
          result.paymentRequirements,
          result.declaredExtensions,
          { request: { adapter: new JsonAdapter(req), path, method: req.method } }
        );
      } catch (err) {
        log.error(`${LOG_PREFIX} settle failed: ${err.message}`);
        return res.status(502).json({ ok: false, error: 'x402_facilitator_error', message: err.message });
      }
      if (!settle.success) return writeSdkResponse(res, settle.response);

      // A successful settle without a transaction id cannot be recorded
      // (tx_hash is the replay guard; '' would collide across payments).
      // Fail safely: loud log, no insert, no serve.
      if (!settle.transaction || typeof settle.transaction !== 'string') {
        log.error(`${LOG_PREFIX} settle succeeded but returned no transaction id (payer=${settle.payer}); refusing to record/serve`);
        return res.status(502).json({ ok: false, error: 'x402_settlement_no_transaction', message: 'facilitator settled without a transaction id; contact support with your payment details' });
      }

      const recorded = await recordSettlementOrReject(pool, res, {
        txHash: settle.transaction,
        payer: settle.payer || 'unknown',
        network: settle.network || cfg.network,
        amountUsd: cfg.bundlePriceUsd,
        bundleCalls: cfg.bundleCalls,
      }, log);
      if (!recorded) return;
      bumpFunnel(pool, 'settlements');
      bumpFunnelDaily(pool, 'x402_settled');

      for (const [key, value] of Object.entries(settle.headers || {})) res.setHeader(key, value);
      // The billing wallet is the facilitator-verified payer (signature-
      // recovered), carried on a trusted request-scoped field. Downstream
      // (rpc_gateway) reads req.x402.wallet — NEVER a client-supplied header —
      // so no request can name a wallet it does not control (P0-2, 2026-09).
      req.x402 = {
        settled: true,
        txHash: settle.transaction,
        payer: settle.payer,
        wallet: (recorded.creditedKey && WALLET_RE.test(settle.payer || '')) ? settle.payer : null,
      };

      // Tell the machine how to continue: credited identity + remaining calls
      // appended to the JSON response body of this (served) request.
      const credited = {
        wallet: (settle.payer || '').toLowerCase(),
        calls_remaining: recorded.callsRemaining,
      };
      const settleJson = res.json.bind(res);
      res.json = (body) =>
        settleJson(body && typeof body === 'object' && !Array.isArray(body) ? { ...body, credited } : body);

      log.info(`${LOG_PREFIX} settled $${cfg.bundlePriceUsd} USDC tx=${settle.transaction} payer=${settle.payer} credited=${recorded.creditedKey} calls=${recorded.callsRemaining}`);
      return next();
    }

    // ---- Rail 1.5 REMOVED (P0-2, 2026-09) ----
    // The former x-payer-address path trusted a client-supplied header to name
    // the billing wallet, letting any caller drain another wallet's prepaid
    // credits (finding C1). Payer identity now comes ONLY from a facilitator-
    // verified x402 payment above (the recovered signer, carried on req.x402).
    // A request with no valid signed authorization falls through to the 402
    // challenge below — it is NEVER billed to a header-supplied wallet.

    // ---- Rail 1: no payment attached — upgrade a downstream exhausted-tier
    // 402 into a spec x402 402, preserving the USDT body as alternativePayment.
    const originalJson = res.json.bind(res);
    res.json = function x402UpgradedJson(body) {
      // Upgrade every ANONYMOUS 402 (gate-exhausted, subnet-capped, or the
      // gateway's keyless PAYMENT_REQUIRED_BODY), not just
      // FREE_TIER_LIMIT_REACHED. In production that branch is unreachable:
      // the /24 subnet check (fts >= 500) fires before the per-IP check
      // (ft > 500) since both default to 500, and Cloudflare/Railway egress
      // rotation smears one machine across many ft: buckets — so real
      // machines only ever see the subnet or keyless-handler 402, which
      // carried no x402 requirements (verified against prod 2026-07-10).
      // Keyed/wallet callers' 402s (credit issues) are never touched.
      const isAnonymous402 =
        res.statusCode === 402 &&
        !req.headers['x-api-key'] &&
        !req.headers['x-wallet-address'];
      if (!isAnonymous402) return originalJson(body);
      res.json = originalJson;

      return (async () => {
        try {
          const server = getServer(cfg);
          await ensureInitialized(server);
          const result = await server.processHTTPRequest({
            adapter: new JsonAdapter(req),
            path,
            method: req.method,
          });
          if (result.type !== 'payment-error' || result.response.status !== 402) {
            return originalJson(body);
          }
          const headers = result.response.headers || {};
          for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
          // v2 carries PaymentRequired in the PAYMENT-REQUIRED header (base64
          // JSON); decode it into the body too so header-blind clients and t2
          // both see accepts + alternativePayment in one JSON document.
          const encoded = headers['PAYMENT-REQUIRED'] || headers['payment-required'];
          const paymentRequired = encoded
            ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
            : {};
          bumpFunnel(pool, 'issued');
          bumpFunnelDaily(pool, 'x402_402_served'); // anonymous exhausted-tier 402 upgraded to a payable x402 challenge
          return originalJson({ ...paymentRequired, alternativePayment: compactAlternativePayment(body) });
        } catch (err) {
          // Fail open to today's exact 402 — the USDT rail must never break
          // because the facilitator is unreachable.
          log.error(`${LOG_PREFIX} 402 upgrade failed, serving legacy 402: ${err.message}`);
          return originalJson(body);
        }
      })();
    };
    return next();
  };
}
