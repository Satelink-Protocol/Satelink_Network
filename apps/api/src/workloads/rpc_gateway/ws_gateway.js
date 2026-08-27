/**
 * WebSocket RPC Gateway
 * S1-RPC-007: WebSocket support for eth_subscribe
 *
 * DeFi protocols and MEV bots use WebSocket for:
 * - eth_subscribe newHeads → new block headers
 * - eth_subscribe newPendingTransactions → pending tx hashes
 *
 * Architecture:
 * - Client connects to /rpc/ws/:chain
 * - Subscribe requests proxied to provider WS
 * - Events streamed back to client + billed
 */

import { WebSocketServer, WebSocket } from 'ws';
import { CHAIN_ALIASES } from './providers.js';
import { shadowWriteRevenueLedger } from '../../ledger/shadow_ledger_write.js';

const WS_PROVIDERS = {
  'polygon-amoy': process.env.WS_POLYGON_AMOY || 'wss://polygon-amoy.g.alchemy.com/v2/demo',
  'polygon': process.env.WS_POLYGON || 'wss://polygon-mainnet.g.alchemy.com/v2/demo',
  'ethereum': process.env.WS_ETHEREUM || 'wss://eth-mainnet.g.alchemy.com/v2/demo',
  'amoy': process.env.WS_POLYGON_AMOY || 'wss://polygon-amoy.g.alchemy.com/v2/demo'
};

const WS_EVENT_PRICE_USDT = 0.000001;
const FREE_TIER_MAX_SUBSCRIPTIONS = 10;

const clientSubscriptions = new Map();
const subscriptionStats = { events: 0, revenue: 0 };

function normalizeChain(chain) {
  return CHAIN_ALIASES[chain] || chain;
}

function getProviderWsUrl(chain) {
  const normalized = normalizeChain(chain);
  return WS_PROVIDERS[normalized] || WS_PROVIDERS[chain] || null;
}

// Free tier removed (2026-08-27): WS RPC requires the SAME credential as HTTP
// /rpc — x-api-key or x-wallet-address. Browser WS clients cannot set custom
// headers, so ?api_key / ?token query params are accepted as equivalents (this
// mirrors free_tier_gate.js's AUTH_SIGNAL_QUERY). An UNAUTHENTICATED upgrade is
// rejected before any subscription can open. This is the fix for the Aug-2026
// ws_subscription storm: an anonymous client could open a newPendingTransactions
// firehose and recordWsRevenue wrote one revenue_events_v2 row PER streamed event
// (100k+/hour), which filled the 1GB volume. No auth → no connection → no writes.
export function wsHasAuth(request) {
  const h = request.headers || {};
  const nonEmpty = (v) => v != null && String(v).length > 0;
  if (nonEmpty(h['x-api-key']) || nonEmpty(h['x-wallet-address'])) return true;
  try {
    const q = new URL(request.url, 'http://ws.local').searchParams;
    if (nonEmpty(q.get('api_key')) || nonEmpty(q.get('token'))) return true;
  } catch (_) { /* malformed URL → treat as unauthenticated */ }
  return false;
}

export function createWsGateway(httpServer, db) {
  const wss = new WebSocketServer({ noServer: true });

  console.log('[WS Gateway] WebSocket server initialized');

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = request.url?.split('?')[0] || '';

    if (!pathname.startsWith('/rpc/ws/')) {
      socket.destroy();
      return;
    }

    // Reject unauthenticated WS RPC — no free tier. (x402 discovery is HTTP-only,
    // so this 401 never touches the paid-discovery path; STOP-B is not implicated.)
    if (!wsHasAuth(request)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (clientWs, req) => {
    const urlPath = req.url || '';
    const chain = urlPath.replace('/rpc/ws/', '').split('?')[0];
    const normalizedChain = normalizeChain(chain);

    const providerUrl = getProviderWsUrl(chain);
    if (!providerUrl) {
      clientWs.send(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: `Unsupported chain: ${chain}` },
        id: null
      }));
      clientWs.close();
      return;
    }

    const clientId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let providerWs = null;
    let subscriptionCount = 0;

    console.log(`[WS Gateway] Client connected: ${clientId} chain=${chain}`);

    function connectToProvider() {
      if (providerWs && providerWs.readyState === WebSocket.OPEN) {
        return providerWs;
      }

      providerWs = new WebSocket(providerUrl);

      providerWs.on('open', () => {
        console.log(`[WS Gateway] Provider connected for ${clientId}`);
      });

      providerWs.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.method === 'eth_subscription' && message.params) {
            subscriptionStats.events++;
            subscriptionStats.revenue += WS_EVENT_PRICE_USDT;

            await recordWsRevenue(db, clientId, chain);
          }

          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(message));
          }
        } catch (err) {
          console.error('[WS Gateway] Provider message error:', err.message);
        }
      });

      providerWs.on('error', (err) => {
        console.error(`[WS Gateway] Provider error: ${err.message}`);
      });

      providerWs.on('close', () => {
        console.log(`[WS Gateway] Provider disconnected for ${clientId}`);
        providerWs = null;
      });

      return providerWs;
    }

    clientWs.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (!message.jsonrpc || message.jsonrpc !== '2.0') {
          clientWs.send(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request' },
            id: message.id || null
          }));
          return;
        }

        if (message.method === 'eth_subscribe') {
          if (subscriptionCount >= FREE_TIER_MAX_SUBSCRIPTIONS) {
            clientWs.send(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: `Max subscriptions (${FREE_TIER_MAX_SUBSCRIPTIONS}) reached` },
              id: message.id
            }));
            return;
          }

          const pws = connectToProvider();

          const waitForOpen = () => new Promise((resolve, reject) => {
            if (pws.readyState === WebSocket.OPEN) {
              resolve();
            } else {
              const onOpen = () => { cleanup(); resolve(); };
              const onError = (e) => { cleanup(); reject(e); };
              const cleanup = () => {
                pws.removeListener('open', onOpen);
                pws.removeListener('error', onError);
              };
              pws.once('open', onOpen);
              pws.once('error', onError);
              setTimeout(() => { cleanup(); reject(new Error('Timeout')); }, 10000);
            }
          });

          try {
            await waitForOpen();
            pws.send(JSON.stringify(message));
            subscriptionCount++;
            console.log(`[WS Gateway] Subscribe: ${message.params?.[0]} (${subscriptionCount} active)`);
          } catch (err) {
            clientWs.send(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: `Provider error: ${err.message}` },
              id: message.id
            }));
          }
        } else if (message.method === 'eth_unsubscribe') {
          if (providerWs && providerWs.readyState === WebSocket.OPEN) {
            providerWs.send(JSON.stringify(message));
            subscriptionCount = Math.max(0, subscriptionCount - 1);
          }
        } else {
          if (providerWs && providerWs.readyState === WebSocket.OPEN) {
            providerWs.send(JSON.stringify(message));
          } else {
            clientWs.send(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'No provider connection' },
              id: message.id
            }));
          }
        }
      } catch (err) {
        clientWs.send(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
          id: null
        }));
      }
    });

    clientWs.on('close', () => {
      console.log(`[WS Gateway] Client disconnected: ${clientId}`);
      if (providerWs) providerWs.close();
      clientSubscriptions.delete(clientId);
    });

    clientWs.on('error', (err) => {
      console.error(`[WS Gateway] Client error: ${err.message}`);
    });

    clientSubscriptions.set(clientId, { chain });
  });

  return wss;
}

async function recordWsRevenue(db, clientId, chain) {
  if (!db || !db.query) return;

  try {
    const now = Math.floor(Date.now() / 1000);
    const revRequestId = `ws_${Date.now()}`;
    await db.query(
      `INSERT INTO revenue_events_v2 (op_type, node_id, client_id, amount_usdt, status, request_id, created_at)
       VALUES ('ws_subscription', $1, $2, $3, 'success', $4, $5)`,
      [chain, clientId, WS_EVENT_PRICE_USDT, revRequestId, now]
    );
    // M3 shadow ledger — flag-gated, isolated pool, never throws.
    shadowWriteRevenueLedger(db, { requestId: revRequestId, amountUsdt: WS_EVENT_PRICE_USDT });
  } catch (e) {
    console.error('[WS Gateway] Revenue error:', e.message);
  }
}

export function getWsStats() {
  return {
    activeConnections: clientSubscriptions.size,
    totalEvents: subscriptionStats.events,
    totalRevenue: subscriptionStats.revenue.toFixed(6)
  };
}

export { WS_PROVIDERS, WS_EVENT_PRICE_USDT };
