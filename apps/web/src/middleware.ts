// CLOUDFLARE DNS REQUIRED:
// developer.satelink.network CNAME → cname.vercel-dns.com
// machine.satelink.network   CNAME → cname.vercel-dns.com
// node.satelink.network      CNAME → cname.vercel-dns.com
// admin.satelink.network     CNAME → cname.vercel-dns.com (already set)
// status.satelink.network    CNAME → cname.vercel-dns.com
// ops.satelink.network       CNAME → cname.vercel-dns.com
// docs.satelink.network      CNAME → custom.mintlify.com (external - Mintlify config)
// VERCEL REQUIRED: Add each subdomain in Vercel project → Settings → Domains

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SUBDOMAIN_MAP: Record<string, string> = {
  'developer': '/satelink/os',
  // machine.satelink.network → the operator dashboard, moved to /machine-console
  // so the apex /machine can be the public "For Agents" page (reposition §6).
  'machine': '/machine-console',
  'node': '/node',
  'admin': '/admin',
  'status': '/status',
  'ops': '/ops',
  // docs.satelink.network serves the in-app documentation portal.
  // DNS: CNAME docs -> cname.vercel-dns.com + add the domain in Vercel.
  'docs': '/docs',
}

// Permanent (308) redirects (§4). CMS-driven Redirect rows are layered on top in
// a later phase; this static map is the edge-cached baseline. Only redirects
// whose targets already exist are enabled — product-move redirects
// (/intelligence → /products/trading-intelligence, /rpc → /products/rpc) are
// added in Phase 6 once those targets ship. `to` may include a hash.
const REDIRECTS: Record<string, string> = {
  '/platform/pricing': '/pricing#platform',
  '/dashboard': '/satelink/os/mission-control',
  // IA-v2 §3 product-move canonicalization — targets shipped in Phase 7.
  // /intelligence/success is a REAL page (the #398 checkout claim) and is
  // intentionally absent here, so it is never redirected.
  '/intelligence': '/products/trading-intelligence',
  '/intelligence/funding-rate-heatmap': '/products/trading-intelligence/funding-rate-heatmap',
  '/intelligence/open-interest-shifts': '/products/trading-intelligence/open-interest-shifts',
  '/intelligence/liquidation-clusters': '/products/trading-intelligence/liquidation-clusters',
  '/intelligence/market-microstructure': '/products/trading-intelligence/market-microstructure',
  '/rpc': '/products/rpc',
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') || ''
  const url = req.nextUrl.clone()

  // Extract subdomain. Strip the port first so localhost:3000 -> "localhost"
  // and works for *.satelink.network in production.
  const subdomain = host.split(':')[0].split('.')[0]

  // Redirects apply on the main site host only (not app subdomains), before any
  // subdomain rewrite, so /platform/pricing and /dashboard resolve everywhere.
  const isAppSubdomain = subdomain in SUBDOMAIN_MAP || subdomain === 'ops'
  if (!isAppSubdomain) {
    const target = REDIRECTS[url.pathname]
    if (target) {
      const [path, hash] = target.split('#')
      url.pathname = path
      url.hash = hash ?? ''
      return NextResponse.redirect(url, 308)
    }
  }

  // Preserve prior behavior: admin subdomain root lands on the command center.
  if (subdomain === 'admin' && url.pathname === '/') {
    url.pathname = '/admin/command-center'
    return NextResponse.redirect(url)
  }

  // ops subdomain: root lands on the command center; all other paths are
  // rewritten under /ops. The pathname is forwarded as a request header so the
  // server-side auth gate in app/ops/layout.tsx can exempt /ops/login (an
  // httpOnly session cookie is unreadable client-side, and layouts don't
  // otherwise receive the pathname — without this the login page would loop).
  if (subdomain === 'ops') {
    if (url.pathname === '/') {
      url.pathname = '/ops/command-center'
      return NextResponse.redirect(url)
    }
    const opsPath = url.pathname.startsWith('/ops') ? url.pathname : `/ops${url.pathname}`
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-ops-pathname', opsPath)
    if (!url.pathname.startsWith('/ops')) {
      url.pathname = opsPath
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    }
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // node subdomain root lands on the setup flow.
  if (subdomain === 'node') {
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/node'
      return NextResponse.redirect(url)
    }
  }

  const prefix = SUBDOMAIN_MAP[subdomain]

  // Only rewrite if it is a known subdomain and path not already prefixed
  if (prefix && !url.pathname.startsWith(prefix)) {
    url.pathname = `${prefix}${url.pathname === '/' ? '' : url.pathname}`
    return NextResponse.rewrite(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
}
