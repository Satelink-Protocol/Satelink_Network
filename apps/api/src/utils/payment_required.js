/**
 * payment_required.js — canonical machine-readable 402 body builder.
 *
 * Every 402 (Payment Required) response in the gateway is enriched with a
 * stable, parseable deposit block so automated payers (erpc, bots, scripts)
 * can read the vault address, chain, minimum, and notify endpoint without
 * scraping prose. Existing per-site fields are preserved — `extra` is spread
 * LAST so any field a caller already returned overrides these defaults
 * (we ADD machine-readable fields, never remove the originals).
 */

export function paymentRequiredFields() {
    return {
        ok: false,
        error: 'payment_required',
        code: 402,
        message: 'Free tier limit reached. Deposit USDT to continue.',
        deposit: {
            vault_address:
                process.env.REVENUE_VAULT_ADDRESS ||
                '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3',
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
            minimum_usdt: '1.00',
            free_tier_limit: 500,
            free_tier_resets_at: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
        },
        // docs.satelink.network/deposit never existed (404) — /docs is the
        // real developer-docs page.
        docs: 'https://satelink.network/docs',
        notify_url: 'https://rpc.satelink.network/api/deposit/notify',
        // Machine-readable service discovery — an agent that hits a 402 can
        // fetch these to learn pricing, deposit flow, and registration.
        manifest_url: 'https://rpc.satelink.network/.well-known/satelink.json',
        pricing_url: 'https://rpc.satelink.network/v1/pricing',
        // Anonymous self-onboarding — no prior key or account needed. Without
        // this, an over-limit anonymous machine has a deposit address but no
        // way to obtain the API key its deposit would credit.
        register_url: 'https://rpc.satelink.network/v1/machine/register',
        register: {
            method: 'POST',
            url: 'https://rpc.satelink.network/v1/machine/register',
            body: {
                wallet_address: '0x<your-funding-wallet>',
                signature: 'personal_sign of "satelink:register:<lowercase wallet_address>"'
            },
            returns: 'api_key — send as X-API-Key header on all subsequent calls'
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
