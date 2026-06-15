import { paymentRequiredResponse } from '../utils/payment_required.js';

export function createBillingMiddleware(db) {
    return function enforceBilling(opType) {
        return (req, res, next) => {
            const apiKey = req.get("X-Enterprise-Key");

            if (!apiKey) {
                // Return 402 if no api key because we are monetizing ops now
                return res.status(402).json(paymentRequiredResponse({ ok: false, error: "Payment Required: Missing X-Enterprise-Key" }));
            }

            try {
                // Fetch key and client
                const keyRecord = db.prepare(`SELECT client_id FROM enterprise_api_keys WHERE api_key = ?`).get(apiKey);
                if (!keyRecord) {
                    return res.status(401).json({ ok: false, error: "Invalid Enterprise API Key" });
                }

                const client = db.prepare(`SELECT * FROM enterprise_clients WHERE client_id = ?`).get(keyRecord.client_id);
                if (!client) {
                    return res.status(401).json({ ok: false, error: "Client not found" });
                }

                if (client.status !== 'ACTIVE') {
                    return res.status(403).json({ ok: false, error: "Client suspended or inactive" });
                }

                const cost = Number(client.rate_per_op);

                // Check balance
                if (Number(client.deposit_balance) < cost) {
                    return res.status(402).json(paymentRequiredResponse({
                        ok: false,
                        error: "Payment Required: Insufficient deposit balance",
                        required: cost,
                        balance: client.deposit_balance
                    }));
                }

                // Deduct balance and record revenue event in an atomic transaction
                const doBilling = db.transaction(() => {
                    const newBalance = Number(client.deposit_balance) - cost;

                    db.prepare(`
                        UPDATE enterprise_clients 
                        SET deposit_balance = ? 
                        WHERE client_id = ?
                    `).run(newBalance, client.client_id);

                    db.prepare(`
                        INSERT INTO revenue_events (amount, token, source, enterprise_id, created_at)
                        VALUES (?, 'USDT', ?, ?, ?)
                    `).run(cost, opType, client.client_id, Date.now());

                    return newBalance;
                });

                const updatedBalance = doBilling();

                // Attach to request for downstream usage (like SLA multipliers)
                req.enterprise = {
                    ...client,
                    deposit_balance: updatedBalance
                };

                // Determine multiplier based on SLA tier
                req.opBilling = {
                    cost,
                    opType,
                    multiplier: client.plan_type === 'ENTERPRISE' ? 2.0 : (client.plan_type === 'PRO' ? 1.5 : 1.0)
                };

                next();

            } catch (error) {
                console.error("[BillingMiddleware]", error);
                res.status(500).json({ ok: false, error: "Internal server billing error" });
            }
        };
    };
}
