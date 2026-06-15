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
            minimum_usdt: '1.00',
            free_tier_limit: 500,
            free_tier_resets_at: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
        },
        docs: 'https://docs.satelink.network/deposit',
        notify_url: 'https://rpc.satelink.network/api/deposit/notify'
    };
}

/**
 * Build a 402 body that merges the canonical machine-readable fields with any
 * existing per-site fields. Existing fields win on key collision.
 */
export function paymentRequiredResponse(extra = {}) {
    return { ...paymentRequiredFields(), ...extra };
}
