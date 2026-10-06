// Trusted client IP for /api/identity/* (Better Auth rate limits key on it).
//
// Resolution order — nothing a browser sends can choose the IP:
//   1. Console server-to-server: when X-Satelink-Console-Auth equals
//      CONSOLE_S2S_SECRET (timing-safe), X-Satelink-End-User-Ip is the end
//      user's IP as seen by the console on Vercel. Without the secret that
//      header is ignored.
//   2. Railway's edge strips client X-Forwarded-For and sets the connecting
//      peer (Railway staff, 2026-06-12); a multi-value header is not trusted.
//      When that peer is a Cloudflare edge, CF-Connecting-IP carries the
//      real client.
//   3. Otherwise the peer itself, then the socket address.
// The result is written to X-Satelink-Client-Ip (any inbound value is
// discarded first) and Better Auth reads only that header.
import { timingSafeEqual } from 'node:crypto';
import net from 'node:net';

export const CLIENT_IP_HEADER = 'x-satelink-client-ip';
export const CONSOLE_AUTH_HEADER = 'x-satelink-console-auth';
export const END_USER_IP_HEADER = 'x-satelink-end-user-ip';

// https://www.cloudflare.com/ips-v4 and /ips-v6
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];
const cloudflare = new net.BlockList();
for (const cidr of CLOUDFLARE_RANGES) {
  const [addr, bits] = cidr.split('/');
  cloudflare.addSubnet(addr, Number(bits), net.isIPv6(addr) ? 'ipv6' : 'ipv4');
}

function clean(ip) {
  if (typeof ip !== 'string') return null;
  let v = ip.trim();
  if (v.startsWith('::ffff:') && net.isIPv4(v.slice(7))) v = v.slice(7);
  return net.isIP(v) ? v : null;
}

/** Rate-limit bucket for an IP: IPv4 as-is, IPv6 grouped by /64. */
export function ipBucket(ip) {
  const v = clean(ip);
  if (!v || !net.isIPv6(v)) return v;
  return expandV6(v.toLowerCase()).split(':').slice(0, 4).join(':') + '::/64';
}

function expandV6(a) {
  const [l, r = ''] = a.split('::');
  const L = l ? l.split(':') : [];
  const R = r ? r.split(':') : [];
  return [...L, ...Array(8 - L.length - R.length).fill('0'), ...R].map((g) => g.padStart(4, '0')).join(':');
}

export function isCloudflare(ip) {
  const v = clean(ip);
  if (!v) return false;
  return cloudflare.check(v, net.isIPv6(v) ? 'ipv6' : 'ipv4');
}

function consoleSecretMatches(given) {
  const secret = process.env.CONSOLE_S2S_SECRET;
  if (!secret || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function resolveClientIp(req) {
  const h = req.headers || {};
  if (consoleSecretMatches(h[CONSOLE_AUTH_HEADER])) {
    const endUser = clean(h[END_USER_IP_HEADER]);
    if (endUser) return endUser;
  }
  // Exactly one value only (Better Auth's own rule): if Railway ever appends
  // instead of stripping, a client-chosen first value must not win.
  const xff = String(h['x-forwarded-for'] || '').split(',').map((v) => v.trim()).filter(Boolean);
  const peer = xff.length === 1 ? clean(xff[0]) : null;
  if (peer && isCloudflare(peer)) {
    const cf = clean(h['cf-connecting-ip']);
    if (cf) return cf;
  }
  return peer || clean(req.socket?.remoteAddress) || null;
}

const HOST_RE = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;
function canonicalHost(host) {
  try {
    const u = process.env.BETTER_AUTH_URL && new URL(process.env.BETTER_AUTH_URL);
    if (u) return u.host;
  } catch { /* fall through */ }
  return typeof host === 'string' && HOST_RE.test(host) ? host : 'api.satelink.network';
}

/** Express middleware: replace any inbound X-Satelink-Client-Ip with the trusted one. */
export function identityClientIp(req, _res, next) {
  // better-call builds Better Auth's Request URL from x-forwarded-proto + host
  // (+ :authority). Client-controlled values there could make Better Auth route
  // a different path than the one our limiter matched — pin them.
  const proto = req.headers['x-forwarded-proto'];
  req.headers['x-forwarded-proto'] = proto === 'http' || proto === 'https' ? proto : 'https';
  delete req.headers[':authority'];
  req.headers.host = canonicalHost(req.headers.host);
  delete req.headers[CLIENT_IP_HEADER];
  const ip = resolveClientIp(req);
  if (ip) req.headers[CLIENT_IP_HEADER] = ip;
  // Never forward the console's credential further into the auth stack.
  delete req.headers[CONSOLE_AUTH_HEADER];
  delete req.headers[END_USER_IP_HEADER];
  next();
}
