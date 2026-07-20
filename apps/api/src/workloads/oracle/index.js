/**
 * S8-004: Oracle Price Feed
 *
 * GET /api/oracle/price/:token — get current price
 *
 * Supported: eth, matic, btc, usdc, usdt, arb, sol
 * Source: CoinGecko API
 * Cache: Redis TTL 60s
 * Revenue: $0.00001 per request
 */

import { Router } from 'express';
import { isFounderApiKey } from '../../payments/founder_wallets.js';

const ORACLE_PRICE_USDT = 0.00001;

const TOKEN_IDS = {
  eth: 'ethereum',
  ethereum: 'ethereum',
  matic: 'matic-network',
  polygon: 'matic-network',
  btc: 'bitcoin',
  bitcoin: 'bitcoin',
  usdc: 'usd-coin',
  usdt: 'tether',
  arb: 'arbitrum',
  arbitrum: 'arbitrum',
  sol: 'solana',
  solana: 'solana',
  avax: 'avalanche-2',
  link: 'chainlink',
  uni: 'uniswap'
};

export function createOracleRouter(pool, redis) {
  const router = Router();

  router.get('/price/:token', async (req, res) => {
    const token = req.params.token.toLowerCase();
    const coingeckoId = TOKEN_IDS[token];

    if (!coingeckoId) {
      return res.status(400).json({
        ok: false,
        error: 'Unsupported token',
        supported: Object.keys(TOKEN_IDS)
      });
    }

    const cacheKey = `rpc:oracle:${token}`;
    let cached = false;
    let price = null;

    try {
      const cachedPrice = await redis?.get(cacheKey);
      if (cachedPrice) {
        price = parseFloat(cachedPrice);
        cached = true;
      }
    } catch (e) {
      // Redis unavailable, continue to fetch
    }

    if (!cached) {
      try {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
          { signal: AbortSignal.timeout(5000) }
        );

        if (!response.ok) {
          throw new Error(`CoinGecko returned ${response.status}`);
        }

        const data = await response.json();
        price = data[coingeckoId]?.usd;

        if (price !== undefined) {
          await redis?.set(cacheKey, price.toString(), 'EX', 60);
        }
      } catch (err) {
        console.error('[Oracle] CoinGecko fetch failed:', err.message);
        return res.status(502).json({ ok: false, error: 'Price feed unavailable' });
      }
    }

    if (price === null || price === undefined) {
      return res.status(404).json({ ok: false, error: 'Price not found' });
    }

    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      try {
        const isTestData = await isFounderApiKey(pool, apiKey);
        await pool.query(
          `INSERT INTO revenue_events_v2 (client_id, service, method, amount_usdt, status, created_at, is_test_data)
           VALUES ($1, 'oracle', $2, $3, 'completed', $4, $5)`,
          [apiKey, token, ORACLE_PRICE_USDT, Math.floor(Date.now() / 1000), isTestData]
        );
      } catch (e) {
        console.error('[Oracle] Revenue recording failed:', e.message);
      }
    }

    res.json({
      ok: true,
      token,
      price_usd: price,
      source: 'coingecko',
      cached,
      timestamp: Date.now()
    });
  });

  router.get('/prices', async (req, res) => {
    const tokens = (req.query.tokens || 'eth,btc,matic').split(',').slice(0, 10);
    const prices = {};

    for (const token of tokens) {
      const t = token.trim().toLowerCase();
      const coingeckoId = TOKEN_IDS[t];
      if (!coingeckoId) continue;

      try {
        const cachedPrice = await redis?.get(`rpc:oracle:${t}`);
        if (cachedPrice) {
          prices[t] = { price_usd: parseFloat(cachedPrice), cached: true };
        }
      } catch (e) {
        // Skip
      }
    }

    const missing = tokens.filter(t => !prices[t.toLowerCase()]);
    if (missing.length > 0) {
      const ids = missing.map(t => TOKEN_IDS[t.toLowerCase()]).filter(Boolean).join(',');
      if (ids) {
        try {
          const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
            { signal: AbortSignal.timeout(5000) }
          );
          const data = await response.json();

          for (const token of missing) {
            const t = token.toLowerCase();
            const id = TOKEN_IDS[t];
            if (data[id]?.usd !== undefined) {
              prices[t] = { price_usd: data[id].usd, cached: false };
              await redis?.set(`rpc:oracle:${t}`, data[id].usd.toString(), 'EX', 60);
            }
          }
        } catch (e) {
          console.error('[Oracle] Batch fetch failed:', e.message);
        }
      }
    }

    res.json({
      ok: true,
      prices,
      timestamp: Date.now()
    });
  });

  return router;
}
