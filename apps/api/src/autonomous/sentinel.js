import { createRequire } from 'module'
import { startAutoScaler } from './auto_scaler.js'
import { startRpcHealer } from './rpc_healer.js'
import { startRevenueMonitor } from './revenue_anomaly.js'
import { startTreasuryMonitor } from './treasury_monitor.js'
import { startCapacityAlerter } from './capacity_alerter.js'
import { isDebug } from '../utils/log_level.js'

export async function startSentinel(pool, redis) {
  console.log('[Sentinel] Started — autonomous operations active')

  startAutoScaler(pool, redis)
  startRpcHealer(redis)
  startRevenueMonitor(pool, redis)
  startTreasuryMonitor(redis)
  startCapacityAlerter(pool, redis)
  
  setInterval(async () => {
    try {
      const epoch = await pool.query("SELECT id, total_revenue FROM epoch_ledger WHERE status='OPEN' ORDER BY id DESC LIMIT 1")
      if (!epoch.rows.length) {
        await pool.query("INSERT INTO epoch_ledger (status, started_at, total_revenue) VALUES ('OPEN', $1, 0)", [Math.floor(Date.now()/1000)])
        console.log('[Sentinel] New epoch opened')
      }
      const revenue = await pool.query("SELECT COALESCE(SUM(amount_usdt),0) as total FROM revenue_events_v2 WHERE created_at > $1", [Math.floor(Date.now()/1000) - 3600])
      // Redis eliminated — revenue tracking is logged only
      if (isDebug) console.log(`[Sentinel] Revenue last hour: ${revenue.rows[0].total} USDT`)
    } catch(e) { console.error('[Sentinel] Error:', e.message) }
  }, 60000)

  setInterval(async () => {
    try {
      // Only mark offline after 24 hours without heartbeat (was 6 min)
      const offline = await pool.query("SELECT node_id, region FROM registered_nodes WHERE status='active' AND last_heartbeat_at < $1", [Math.floor(Date.now()/1000) - 86400])
      for (const node of offline.rows) {
        await pool.query("UPDATE registered_nodes SET status='offline' WHERE node_id=$1", [node.node_id])
        console.log(`[Sentinel] Node ${node.node_id} marked offline (no heartbeat 24h)`)
      }
    } catch(e) { console.error('[Sentinel] Node check error:', e.message) }
  }, 120000)
}
