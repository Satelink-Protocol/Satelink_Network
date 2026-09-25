// Minimal Dodo REST client (mode-aware). The key is read from env at call
// time and never logged. Test mode: DODO_API_KEY_TEST ?? DODO_TESTMODE_API_KEY.
export function dodoBase(mode) {
  return mode === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
}
export function dodoKey(mode) {
  return mode === 'live' ? process.env.DODO_API_KEY_LIVE : (process.env.DODO_API_KEY_TEST || process.env.DODO_TESTMODE_API_KEY);
}
export async function dodoRequest(mode, method, path, body, { fetchImpl = globalThis.fetch } = {}) {
  const key = dodoKey(mode);
  if (!key) throw Object.assign(new Error(`Dodo ${mode} key not configured`), { code: 'dodo_not_configured' });
  const r = await fetchImpl(dodoBase(mode) + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  if (!r.ok) throw Object.assign(new Error(`Dodo ${method} ${path} → ${r.status}`), { code: 'dodo_error', status: r.status, body: json ?? text.slice(0, 200) });
  return json;
}
