// Portfolio stream (Stage 22): order / position / holding updates over WebSocket.
// GET /v2/feed/portfolio-stream-feed/authorize?update_types=… returns a ONE-TIME wss URL (its `code`
// is single use), so no Authorization header is needed on the socket and every reconnect must
// re-authorize. The WebSocket factory is injected.
import { BrokerError, BrokerErrorCode } from '../errors.mjs';
import { mapStreamMessage } from './mapping.mjs';

const TYPES = new Set(['order', 'gtt_order', 'position', 'holding']);

export async function openPortfolioStream({ rest, apiBase, token, updateTypes = ['order', 'position'], webSocketFactory, onUpdate, onError = () => {}, isOurs }) {
  if (!updateTypes.length || updateTypes.some((t) => !TYPES.has(t))) throw new BrokerError(BrokerErrorCode.INVALID_REQUEST, { venue: 'upstox', message: 'bad update_types' });
  const r = await rest.request('GET', `${apiBase}/v2/feed/portfolio-stream-feed/authorize`, { token, query: { update_types: updateTypes.join(',') } });
  const url = r?.data?.authorized_redirect_uri;
  if (typeof url !== 'string' || !url.startsWith('wss://')) throw new BrokerError(BrokerErrorCode.VENUE_UNAVAILABLE, { venue: 'upstox', message: 'portfolio stream authorization returned no wss URL' });
  const ws = webSocketFactory(url);
  ws.addEventListener('message', (ev) => {
    try {
      const text = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
      const u = mapStreamMessage(JSON.parse(text), isOurs ? { isOurs } : undefined);
      if (u) onUpdate(u);
    } catch (e) { onError(e); }
  });
  ws.addEventListener('error', (e) => onError(e));
  return Object.freeze({ close: () => ws.close() });
}
