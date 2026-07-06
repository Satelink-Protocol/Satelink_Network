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
  'machine': '/machine',
  'node': '/node',
  'admin': '/admin',
  'status': '/status',
  'ops': '/ops',
  // docs.satelink.network serves the in-app documentation portal.
  // DNS: CNAME docs -> cname.vercel-dns.com + add the domain in Vercel.
  'docs': '/docs',
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') || ''
  const url = req.nextUrl.clone()

  // Extract subdomain. Strip the port first so localhost:3000 -> "localhost"
  // and works for *.satelink.network in production.
  const subdomain = host.split(':')[0].split('.')[0]

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
