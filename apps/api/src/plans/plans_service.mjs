// Track B (P3.B) — plan catalogue reads. Read-only; no money-path coupling.
export async function listPlans(pool) {
  const { rows } = await pool.query(
    `SELECT id, name, price_monthly_usd, price_yearly_usd, included_calls,
            overage_per_call_usd, api_keys, rate_limit
       FROM plans WHERE active = true ORDER BY sort ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    price: { monthly: Number(r.price_monthly_usd), yearly: Number(r.price_yearly_usd) },
    includedCalls: Number(r.included_calls),
    overagePerCall: r.overage_per_call_usd == null ? null : Number(r.overage_per_call_usd),
    apiKeys: Number(r.api_keys),
    rateLimit: r.rate_limit,
  }));
}

export async function getPlan(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, name, price_monthly_usd, price_yearly_usd, included_calls,
            overage_per_call_usd, api_keys, rate_limit
       FROM plans WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}
