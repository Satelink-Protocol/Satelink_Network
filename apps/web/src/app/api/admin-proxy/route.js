// apps/web/src/app/api/admin-proxy/route.js
// Server-side proxy for the Admin Command Center (App Router route handler).
// ADMIN_TOKEN is read on the server only and never reaches the browser.
// Its value MUST match the API's ADMIN_SECRET_TOKEN.
//
// Gate 0 B-02 (2026-10-07): this proxy previously injected ADMIN_TOKEN for ANY
// caller — an open admin relay. It now returns 404 unless the admin UI gate
// passes (ADMIN_UI_ENABLED=true AND a server-verified staff session; see
// src/lib/admin-ui-gate.ts — no such session exists yet, so it is OFF).
// ADMIN_TOKEN is never read before the gate and path check pass.
//
// Client usage (from the admin dashboard):
//   const adminFetch = (path, opts = {}) =>
//     fetch('/api/admin-proxy', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ path, method: opts.method || 'GET', body: opts.body }),
//     }).then(r => r.json());

import { adminUiAllowed, notFoundResponse, resolveAdminUpstream } from '@/lib/admin-ui-gate';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://rpc.satelink.network';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSE pass-through for the admin live feed.
// EventSource cannot set the x-admin-token header, so the token is injected
// here server-side and the upstream text/event-stream is piped straight back
// to the browser. Used as: new EventSource('/api/admin-proxy?stream=live/feed')
async function stream(req) {
  if (!adminUiAllowed(req)) return notFoundResponse();

  const { searchParams } = new URL(req.url);
  const streamPath = searchParams.get('stream');
  if (!streamPath) return proxy(req); // no stream param → normal JSON proxy

  const upstream = resolveAdminUpstream(API_BASE, streamPath);
  if (!upstream) return notFoundResponse();

  const token = process.env.ADMIN_TOKEN; // server-side only
  if (!token) {
    return Response.json({ ok: false, error: 'ADMIN_TOKEN not configured' }, { status: 503 });
  }

  try {
    const res = await fetch(upstream, {
      headers: { 'x-admin-token': token, Accept: 'text/event-stream' },
    });
    if (!res.ok || !res.body) {
      return Response.json({ ok: false, error: `upstream ${res.status}` }, { status: res.status || 502 });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}

async function proxy(req) {
  if (!adminUiAllowed(req)) return notFoundResponse();

  let payload = {};
  try { payload = await req.json(); } catch { /* empty body */ }
  const { path = '', method = 'GET', body } = payload;

  // Only forward to /admin/* on the API — no open relay, no traversal.
  const upstream = resolveAdminUpstream(API_BASE, path);
  if (!upstream) return notFoundResponse();
  const verb = String(method).toUpperCase();
  if (!ALLOWED_METHODS.has(verb)) return notFoundResponse();

  const token = process.env.ADMIN_TOKEN; // server-side only
  if (!token) {
    return Response.json({ ok: false, error: 'ADMIN_TOKEN not configured' }, { status: 503 });
  }

  try {
    const result = await fetch(upstream, {
      method: verb,
      headers: { 'x-admin-token': token, 'Content-Type': 'application/json' },
      body: verb !== 'GET' && body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await result.json().catch(() => ({ ok: false, error: 'non-JSON upstream response' }));
    return Response.json(data, { status: result.status });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}

export const POST = proxy;
export const GET = stream; // ?stream=<path> → SSE; otherwise JSON proxy
