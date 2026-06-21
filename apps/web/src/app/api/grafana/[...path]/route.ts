// apps/web/src/app/api/grafana/[...path]/route.ts
//
// Server-side reverse proxy for embedded Grafana. The browser never talks to
// Grafana directly — every panel/dashboard/asset request goes through here so:
//   * the Grafana base URL + service-account token stay server-only,
//   * Satelink's own session/auth fronts the dashboards,
//   * frame-blocking headers (X-Frame-Options / CSP frame-ancestors) are
//     stripped so the panels can be embedded inside the Satelink OS shell.
//
// Embed URLs are preserved verbatim: a panel iframe pointed at
//   /api/grafana/d-solo/<uid>/<slug>?panelId=1&theme=dark
// is forwarded to
//   ${GRAFANA_URL}/d-solo/<uid>/<slug>?panelId=1&theme=dark
//
// Required env (server-only):
//   GRAFANA_URL    e.g. https://grafana.internal.satelink.network
//   GRAFANA_TOKEN  Grafana service-account token (Bearer)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRAFANA_URL = (process.env.GRAFANA_URL || "").replace(/\/+$/, "");
const GRAFANA_TOKEN = process.env.GRAFANA_TOKEN || "";

// Hop-by-hop + framing headers we must not pass back to the browser.
const STRIP_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function notConfigured(): Response {
  return Response.json(
    {
      ok: false,
      error:
        "Grafana embed proxy is not configured. Set GRAFANA_URL and GRAFANA_TOKEN.",
    },
    { status: 503 }
  );
}

async function forward(
  req: Request,
  segments: string[]
): Promise<Response> {
  if (!GRAFANA_URL || !GRAFANA_TOKEN) return notConfigured();

  const incoming = new URL(req.url);
  const path = segments.map(encodeURIComponent).join("/");
  const upstream = `${GRAFANA_URL}/${path}${incoming.search}`;

  // Forward a minimal, safe set of request headers + inject auth.
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${GRAFANA_TOKEN}`);
  const accept = req.headers.get("accept");
  if (accept) headers.set("Accept", accept);
  const ct = req.headers.get("content-type");
  if (ct) headers.set("Content-Type", ct);

  const method = req.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

  let res: Response;
  try {
    res = await fetch(upstream, {
      method,
      headers,
      body,
      redirect: "manual",
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: `Grafana upstream unreachable: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  // Rebuild response headers, dropping the framing/hop-by-hop set.
  const outHeaders = new Headers();
  res.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      outHeaders.set(key, value);
    }
  });
  // Explicitly permit same-origin embedding of the proxied content.
  outHeaders.set("Content-Security-Policy", "frame-ancestors 'self'");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return forward(req, path ?? []);
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return forward(req, path ?? []);
}
