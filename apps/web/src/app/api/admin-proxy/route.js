// apps/web/src/app/api/admin-proxy/route.js
// Server-side proxy for the Admin Command Center (App Router route handler).
// ADMIN_TOKEN is read on the server only and never reaches the browser.
// Its value MUST match the API's ADMIN_SECRET_TOKEN.
//
// Client usage (from the admin dashboard):
//   const adminFetch = (path, opts = {}) =>
//     fetch('/api/admin-proxy', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ path, method: opts.method || 'GET', body: opts.body }),
//     }).then(r => r.json());

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://rpc.satelink.network';

async function proxy(req) {
  const token = process.env.ADMIN_TOKEN; // server-side only
  if (!token) {
    return Response.json({ ok: false, error: 'ADMIN_TOKEN not configured' }, { status: 503 });
  }

  let payload = {};
  try { payload = await req.json(); } catch { /* empty body */ }
  const { path = '', method = 'GET', body } = payload;

  // Only allow forwarding to /admin/* on the API — no open relay.
  const cleanPath = String(path).replace(/^\/+/, '');
  const upstream = `${API_BASE}/admin/${cleanPath}`;

  try {
    const result = await fetch(upstream, {
      method,
      headers: { 'x-admin-token': token, 'Content-Type': 'application/json' },
      body: method !== 'GET' && body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await result.json().catch(() => ({ ok: false, error: 'non-JSON upstream response' }));
    return Response.json(data, { status: result.status });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}

export const POST = proxy;
export const GET = proxy;
