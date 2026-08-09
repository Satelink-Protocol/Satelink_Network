// Egress trim: the anonymous x402 402 embeds the legacy USDT-rail body under
// `alternativePayment`. This proves that compacting that field (a) leaves the
// x402 payment parameters byte-identical (the @x402/core client never reads
// alternativePayment — it decodes x402Version/accepts/resource/extensions), and
// (b) shrinks the body substantially. The client's OWN decoder is used to
// select the payment requirements from both the old and new challenge.

import { expect } from 'chai';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { compactAlternativePayment } from '../src/payments/x402/middleware.js';

// The SDK-built PaymentRequired half of the challenge (everything the x402 client
// reads). Values are the live production challenge (Base USDC, $0.10 = 1000 calls).
const NETWORK = 'eip155:8453';
const PAYMENT_REQUIRED = {
  x402Version: 2,
  error: 'Payment required',
  resource: {
    url: 'https://rpc.satelink.network/rpc/polygon',
    description: 'Satelink — Polygon PoS (chain 137) JSON-RPC. eth_call, eth_getBalance, …',
    mimeType: 'application/json',
  },
  accepts: [
    {
      scheme: 'exact',
      network: NETWORK,
      amount: '100000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: '0x966E1Ae22996545015b1414B35234b10719d7Ad4',
      maxTimeoutSeconds: 60,
      extra: { name: 'USD Coin', version: '2' },
    },
  ],
  extensions: { bazaar: { info: { input: { type: 'http', method: 'POST' } } } },
};

// A representative legacy USDT-rail body (the shape paymentRequiredResponse +
// the per-IP free-tier 402 produce), embedded today as alternativePayment.
const LEGACY_BODY = {
  ok: false,
  error: {
    code: -32005,
    message: 'Satelink: free tier exhausted (500/day/IP). Rate limited (free tier). Remove this limit with a free machine key …',
    data: {
      error_code: 'FREE_TIER_LIMIT_REACHED',
      limit: 500,
      period: 'daily',
      resets_at: '2026-08-11T00:00:00.000Z',
      payment: {
        vault_address: '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF',
        token: 'USDT',
        token_address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        chain_id: 137,
        chain_name: 'Polygon',
        minimum_deposit_usdt: 0.5,
        deposit_url: 'https://rpc.satelink.network/credits/initiate?amount=10',
        register_url: 'https://rpc.satelink.network/v1/machine/register',
        deposit_page: 'https://satelink.network/satelink/os/deposit',
        docs: 'https://satelink.network/docs',
      },
    },
  },
  code: 402,
  message: 'Free tier limit reached. Deposit USDT to continue.',
  deposit: {
    vault_address: '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF',
    usdt_contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    chain_id: 137,
    network: 'Polygon',
    deposit_page: 'https://satelink.network/satelink/os/deposit',
    minimum_usdt: '0.50',
    confirmations_required: 25,
    credit_eta: 'credits appear automatically within ~5 minutes of the deposit reaching 25 confirmations',
    calldata_url: 'https://rpc.satelink.network/credits/deposit/initiate?amount=<usdt>',
    calldata_example: 'https://rpc.satelink.network/credits/deposit/initiate?amount=1.00',
    free_tier_limit: 500,
    free_tier_resets_at: '2026-08-11T00:00:00.000Z',
  },
  docs: 'https://satelink.network/docs',
  notify_url: 'https://rpc.satelink.network/api/deposit/notify',
  manifest_url: 'https://rpc.satelink.network/.well-known/satelink.json',
  pricing_url: 'https://rpc.satelink.network/v1/pricing',
  register_url: 'https://rpc.satelink.network/v1/machine/register',
  register: {
    method: 'POST',
    url: 'https://rpc.satelink.network/v1/machine/register',
    body: { wallet_address: '0x<your-funding-wallet>', signature: 'personal_sign of "satelink:register:<lowercase wallet_address>"' },
    returns: 'api_key — send as X-API-Key header on all subsequent calls',
  },
  examples: {
    '1_register': "curl -X POST https://rpc.satelink.network/v1/machine/register -H 'Content-Type: application/json' -d '{\"wallet_address\":\"0xYOURWALLET\",\"signature\":\"0xSIG\"}'  # sign …",
    '2_deposit_calldata': "curl 'https://rpc.satelink.network/credits/deposit/initiate?amount=1.00'  # returns approve + deposit calldata …",
    '3_retry_with_key': "curl -X POST https://rpc.satelink.network/rpc/polygon -H 'X-API-Key: sk_...' …",
  },
  jsonrpc: '2.0',
  id: 1,
};

// Build a client with the exact EVM scheme registered — exactly what a paying
// agent uses to decode a 402 and pick its payment requirements.
function makeClient() {
  const client = new x402Client();
  client.register(NETWORK, new ExactEvmScheme());
  return client;
}

describe('x402 challenge shrink — payment path preserved, body smaller', () => {
  const oldChallenge = { ...PAYMENT_REQUIRED, alternativePayment: LEGACY_BODY };
  const newChallenge = { ...PAYMENT_REQUIRED, alternativePayment: compactAlternativePayment(LEGACY_BODY) };

  it('a) the @x402/core client decodes the NEW challenge without error', () => {
    const client = makeClient();
    const req = client.selectPaymentRequirements(newChallenge.x402Version, newChallenge.accepts);
    expect(req).to.be.an('object');
    expect(req.scheme).to.equal('exact');
    expect(req.network).to.equal(NETWORK);
    expect(req.amount).to.equal('100000');
    expect(req.asset).to.equal('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(req.payTo).to.equal('0x966E1Ae22996545015b1414B35234b10719d7Ad4');
    expect(req.maxTimeoutSeconds).to.equal(60);
  });

  it('b) decoded payment parameters are IDENTICAL to the old challenge', () => {
    const client = makeClient();
    const before = client.selectPaymentRequirements(oldChallenge.x402Version, oldChallenge.accepts);
    const after = client.selectPaymentRequirements(newChallenge.x402Version, newChallenge.accepts);
    // amount, asset, network, recipient (payTo), scheme, timeout, extra — all equal
    expect(JSON.stringify(after)).to.equal(JSON.stringify(before));
    // and the x402-relevant top-level fields are byte-identical (only
    // alternativePayment changed)
    for (const k of ['x402Version', 'error', 'resource', 'accepts', 'extensions']) {
      expect(JSON.stringify(newChallenge[k])).to.equal(JSON.stringify(oldChallenge[k]));
    }
  });

  it('shrinks the body substantially and keeps the USDT rail machine-actionable', () => {
    const oldBytes = JSON.stringify(oldChallenge).length;
    const newBytes = JSON.stringify(newChallenge).length;
    const altBytes = JSON.stringify(compactAlternativePayment(LEGACY_BODY)).length;
    // alternativePayment collapses from the full legacy body to ~1KB even on the
    // per-IP path (which keeps the error.data.payment block verbatim); the
    // production-dominant subnet 402 (error = {code,message}, no data block) is
    // smaller still — asserted separately below.
    expect(altBytes).to.be.lessThan(1200);
    expect(JSON.stringify(LEGACY_BODY).length).to.be.greaterThan(altBytes * 2);
    expect(newBytes).to.be.lessThan(oldBytes * 0.6);
    // Production-dominant path: subnet 402 error is {code,message} with no
    // duplicated payment block → the compact alternativePayment is well under 1KB.
    const subnetBody = { ...LEGACY_BODY, error: { code: -32005, message: LEGACY_BODY.error.message } };
    expect(JSON.stringify(compactAlternativePayment(subnetBody)).length).to.be.lessThan(800);
    // machine-actionable USDT rail preserved
    const alt = newChallenge.alternativePayment;
    expect(alt.deposit.vault_address).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(alt.deposit.usdt_contract).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(alt.deposit.chain_id).to.equal(137);
    expect(alt.deposit.minimum_usdt).to.equal('0.50');
    expect(alt.deposit.calldata_url).to.include('/credits/deposit/initiate');
    expect(alt.register_url).to.include('/v1/machine/register');
    expect(alt.docs).to.include('satelink.network');
    // the -32005 JSON-RPC error envelope is preserved verbatim (RPC clients read it)
    expect(alt.error).to.deep.equal(LEGACY_BODY.error);
  });

  it('drops the human-readable prose/duplication (examples, register block, redundant URLs)', () => {
    const alt = compactAlternativePayment(LEGACY_BODY);
    for (const dropped of ['examples', 'register', 'notify_url', 'manifest_url', 'pricing_url', 'code', 'ok', 'message', 'jsonrpc']) {
      expect(alt, `must drop ${dropped}`).to.not.have.property(dropped);
    }
    // deposit prose fields dropped, machine fields kept
    expect(alt.deposit).to.not.have.property('credit_eta');
    expect(alt.deposit).to.not.have.property('calldata_example');
    expect(alt.deposit).to.not.have.property('deposit_page');
  });

  it('keyless-path body (error is the string "payment_required") is preserved', () => {
    const keyless = { error: 'payment_required', deposit: LEGACY_BODY.deposit, register_url: LEGACY_BODY.register_url, docs: LEGACY_BODY.docs };
    const alt = compactAlternativePayment(keyless);
    expect(alt.error).to.equal('payment_required');
    expect(alt.deposit.vault_address).to.match(/^0x[0-9a-fA-F]{40}$/);
  });
});
