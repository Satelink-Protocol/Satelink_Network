/**
 * payment_required.js — canonical machine-readable 402 body builder.
 *
 * Every 402 (Payment Required) response in the gateway is enriched with a
 * stable, parseable deposit block so automated payers (erpc, bots, scripts)
 * can read the vault address, chain, minimum, and notify endpoint without
 * scraping prose. Existing per-site fields are preserved — `extra` is spread
 * LAST so any field a caller already returned overrides these defaults
 * (we ADD machine-readable fields, never remove the originals).
 *
 * The body must be fully self-contained: a machine with no prior knowledge of
 * Satelink has to be able to register, fetch deposit calldata, deposit, and
 * retry — using only fields in this response (manifest/pricing URLs are for
 * depth, not required reading).
 */

import { MIN_CONFIRMATIONS } from '../billing/deposit_validation.mjs';

export function paymentRequiredFields() {
    const apiBase = process.env.API_BASE_URL || 'https://rpc.satelink.network';
    // Same env var + default as machine_onboarding.js and deposit_listener.js.
    // The 402 previously hardcoded '1.00' while /v1/pricing (and the listener's
    // actual crediting threshold) said 0.50 — machines were told the wrong minimum.
    const minDeposit = parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50').toFixed(2);
    const registerUrl = `${apiBase}/v1/machine/register`;
    const calldataExampleUrl = `${apiBase}/credits/deposit/initiate?amount=1.00`;
    return {
        ok: false,
        error: 'payment_required',
        code: 402,
        message: 'Free tier limit reached. Deposit USDT to continue.',
        deposit: {
            vault_address:
                process.env.REVENUE_VAULT_ADDRESS ||
                '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF',
            usdt_contract:
                process.env.POLYGON_USDT_ADDRESS ||
                '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
            chain_id: 137,
            network: 'Polygon',
            // Human-clickable self-service deposit page (machine fields above/below
            // stay as-is). A developer hitting this 402 in their terminal/logs can
            // open this to deposit without already having a wallet-signing tool wired.
            // NOTE: served from the apex domain — app.satelink.network returns
            // Vercel DEPLOYMENT_NOT_FOUND (dead domain alias) as of 2026-07-04.
            deposit_page: 'https://satelink.network/satelink/os/deposit',
            minimum_usdt: minDeposit,
            confirmations_required: MIN_CONFIRMATIONS,
            credit_eta: `credits appear automatically within ~5 minutes of the deposit reaching ${MIN_CONFIRMATIONS} confirmations`,
            // Ready-to-sign transaction calldata (USDT approve + vault deposit) for
            // any amount — a machine with no ABI tooling fetches this, signs the two
            // payloads from its registered wallet, and broadcasts them.
            calldata_url: `${apiBase}/credits/deposit/initiate?amount=<usdt>`,
            calldata_example: calldataExampleUrl,
            free_tier_limit: 500,
            free_tier_resets_at: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
        },
        // docs.satelink.network/deposit never existed (404) — /docs is the
        // real developer-docs page.
        docs: 'https://satelink.network/docs',
        notify_url: `${apiBase}/api/deposit/notify`,
        // Machine-readable service discovery — an agent that hits a 402 can
        // fetch these to learn pricing, deposit flow, and registration.
        manifest_url: `${apiBase}/.well-known/satelink.json`,
        pricing_url: `${apiBase}/v1/pricing`,
        // Anonymous self-onboarding — no prior key or account needed. Without
        // this, an over-limit anonymous machine has a deposit address but no
        // way to obtain the API key its deposit would credit.
        register_url: registerUrl,
        register: {
            method: 'POST',
            url: registerUrl,
            body: {
                wallet_address: '0x<your-funding-wallet>',
                signature: 'personal_sign of "satelink:register:<lowercase wallet_address>"'
            },
            returns: 'api_key — send as X-API-Key header on all subsequent calls'
        },
        // Copy-paste onboarding: the exact commands that take a machine (or a
        // developer in a terminal) from this 402 to a funded, authenticated caller.
        examples: {
            '1_register': `curl -X POST ${registerUrl} -H 'Content-Type: application/json' -d '{"wallet_address":"0xYOURWALLET","signature":"0xSIG"}'  # sign "satelink:register:0xyourwallet" (lowercase) with EIP-191 personal_sign; POST without signature to be told the exact message`,
            '2_deposit_calldata': `curl '${calldataExampleUrl}'  # returns approve + deposit calldata; sign & broadcast both from the registered wallet`,
            '3_retry_with_key': `curl -X POST ${apiBase}/rpc/polygon -H 'X-API-Key: sk_...' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
        }
    };
}

/**
 * Build a 402 body that merges the canonical machine-readable fields with any
 * existing per-site fields. Existing fields win on key collision.
 */
export function paymentRequiredResponse(extra = {}) {
    return { ...paymentRequiredFields(), ...extra };
}
