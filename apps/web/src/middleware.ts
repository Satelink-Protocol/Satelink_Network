// CLOUDFLARE DNS REQUIRED:
// developer.satelink.network CNAME → cname.vercel-dns.com
// machine.satelink.network   CNAME → cname.vercel-dns.com
// node.satelink.network      CNAME → cname.vercel-dns.com
// admin.satelink.network     CNAME → cname.vercel-dns.com (already set)
// status.satelink.network    CNAME → cname.vercel-dns.com
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

  // node subdomain root lands on the setup flow.
  if (subdomain === 'node') {
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/node/setup'
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
