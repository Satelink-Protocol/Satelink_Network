import express from 'express'
import { isFounderApiKey } from '../../payments/founder_wallets.js'

export function createBandwidthRouter(pool, redis) {
  const router = express.Router()

  router.post('/proxy', async (req, res) => {
    const { url, method = 'GET', headers = {}, body } = req.body
    const apiKey = req.headers['x-api-key']
    if (!url) return res.status(400).json({ error: 'url required' })
    try {
      const { default: fetch } = await import('node-fetch')
      const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
      const text = await response.text()
      const kb = Buffer.byteLength(text) / 1024
      const cost = Math.max(0.0001, kb * 0.0001).toFixed(8)
      const isTestData = await isFounderApiKey(pool, apiKey)
      await pool.query('INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, is_test_data) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['bandwidth', apiKey || 'public', cost, 'completed', 'bw_' + Date.now(), Math.floor(Date.now()/1000), isTestData])
      res.json({ ok: true, status: response.status, body: text.slice(0, 10000), kb: kb.toFixed(2), cost_usdt: cost })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  router.post('/scrape', async (req, res) => {
    const { url } = req.body
    const apiKey = req.headers['x-api-key']
    if (!url) return res.status(400).json({ error: 'url required' })
    try {
      const { default: fetch } = await import('node-fetch')
      const r = await fetch(url, { headers: { 'User-Agent': 'Satelink-Scraper/1.0' } })
      const html = await r.text()
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || ''
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000)
      const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]).slice(0, 20)
      const isTestData = await isFounderApiKey(pool, apiKey)
      await pool.query('INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, is_test_data) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['scrape', apiKey || 'public', '0.001', 'completed', 'sc_' + Date.now(), Math.floor(Date.now()/1000), isTestData])
      res.json({ ok: true, title, text, links, cost_usdt: '0.001000' })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  return router
}
