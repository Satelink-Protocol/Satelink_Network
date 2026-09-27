/**
 * The atomic per-call deduction, by product (fix/dodo-rpc-boundary).
 * Dodo money (card/UPI) pays for Trading Intelligence ONLY; the unspent Dodo
 * part of credits_usdt is ring-fenced in dodo_funded_usdt (creditAccount with
 * fundingSource 'dodo'). This is the consumption point that enforces it:
 *   · 'intelligence' may spend all of credits_usdt and draws the ring-fence
 *     down first (Dodo value is used before crypto value);
 *   · every other product (rpc, and x402-alias calls, which meter as rpc) may
 *     spend only credits_usdt − dodo_funded_usdt.
 * The RPC variant reads the fence through to_jsonb so the RPC hot path keeps
 * working even if the boot DDL that adds the column had failed (no fence, but
 * no outage). $1 = cost, $2 = api_key.
 */
export function deductSql(product) {
  if (product === 'intelligence') {
    return `UPDATE api_credits
        SET credits_usdt     = credits_usdt - $1,
            dodo_funded_usdt = GREATEST(0, COALESCE(dodo_funded_usdt, 0) - $1),
            total_spent      = COALESCE(total_spent, 0) + $1,
            last_used        = NOW()
      WHERE api_key = $2 AND credits_usdt >= $1
      RETURNING credits_usdt`;
  }
  return `UPDATE api_credits
        SET credits_usdt = credits_usdt - $1,
            total_spent  = COALESCE(total_spent, 0) + $1,
            last_used    = NOW()
      WHERE api_key = $2
        AND credits_usdt - COALESCE((to_jsonb(api_credits) ->> 'dodo_funded_usdt')::numeric, 0) >= $1
      RETURNING credits_usdt`;
}
