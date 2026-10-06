// Gate 0 B-02/B-03 hotfix (2026-10-07) — audit 06 S-01 (open admin proxy) and
// S-02 (forgeable /ops cookie). Every staff surface in apps/web must 404 for
// callers without a server-verified staff session — which does not exist yet,
// so they 404 for everyone, including with ADMIN_UI_ENABLED=true and with the
// old forgeable cookies. ADMIN_TOKEN / GRAFANA_TOKEN must never be forwarded.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import {
  adminUiAllowed,
  adminUiEnabled,
  isGatedPagePath,
  resolveAdminUpstream,
  safeGrafanaSegments,
} from "@/lib/admin-ui-gate";
import * as adminProxy from "@/app/api/admin-proxy/route.js";
import * as grafana from "@/app/api/grafana/[...path]/route";
import * as opsAuth from "@/app/api/ops-auth/route";
import { middleware } from "@/middleware";

const TOKEN = "test-admin-token-never-forwarded";
const FORGED_COOKIES = "ops-session=1; x-admin-token=anything";
const API = "https://rpc.satelink.network";

let fetchSpy: ReturnType<typeof vi.fn>;
const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.ADMIN_TOKEN = TOKEN;
  process.env.GRAFANA_URL = "https://grafana.example";
  process.env.GRAFANA_TOKEN = "grafana-token";
  delete process.env.ADMIN_UI_ENABLED;
  fetchSpy = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

const MODES: Array<[string, string | undefined]> = [
  ["ADMIN_UI_ENABLED unset", undefined],
  ["ADMIN_UI_ENABLED=true (no staff session exists)", "true"],
];

function setMode(v: string | undefined) {
  if (v === undefined) delete process.env.ADMIN_UI_ENABLED;
  else process.env.ADMIN_UI_ENABLED = v;
}

function postProxy(path: unknown, cookie = FORGED_COOKIES) {
  return new Request("https://satelink.network/api/admin-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ path, method: "GET" }),
  });
}

function expectNoUpstream() {
  expect(fetchSpy).not.toHaveBeenCalled();
}

describe("admin UI gate", () => {
  it("is off by default and stays off when enabled (no verified staff session)", () => {
    expect(adminUiEnabled()).toBe(false);
    expect(adminUiAllowed()).toBe(false);
    process.env.ADMIN_UI_ENABLED = "true";
    expect(adminUiEnabled()).toBe(true);
    expect(adminUiAllowed(new Request("https://x/", { headers: { cookie: FORGED_COOKIES } }))).toBe(false);
  });

  it("only the exact string 'true' enables", () => {
    for (const v of ["1", "TRUE", "yes", " true", ""]) {
      process.env.ADMIN_UI_ENABLED = v;
      expect(adminUiEnabled()).toBe(false);
    }
  });

  it("gates /admin and /ops page paths on segment boundaries only", () => {
    for (const p of ["/admin", "/admin/", "/admin/command-center", "/ops", "/ops/login", "/ops/command-center"]) {
      expect(isGatedPagePath(p)).toBe(true);
    }
    for (const p of ["/", "/pricing", "/administrator", "/opsx", "/docs/admin"]) {
      expect(isGatedPagePath(p)).toBe(false);
    }
  });
});

describe("resolveAdminUpstream (path traversal)", () => {
  it("keeps legitimate admin paths under /admin/", () => {
    expect(resolveAdminUpstream(API, "/executive/summary?window=24h")).toBe(
      `${API}/admin/executive/summary?window=24h`
    );
    expect(resolveAdminUpstream(API, "treasury/status")).toBe(`${API}/admin/treasury/status`);
    expect(resolveAdminUpstream(API, "live/feed")).toBe(`${API}/admin/live/feed`);
  });

  it.each([
    "../health",
    "/../rpc",
    "foo/../../credits",
    "%2e%2e/health",
    "%2E%2E%2Fhealth",
    "foo/%2e%2e/%2e%2e/rpc",
    "..%2fhealth",
    "\\..\\health",
    "foo\\bar",
    "https://evil.example/x",
    "javascript:alert(1)",
    "",
    "/",
    "foo\nbar",
    "%ZZ",
  ])("rejects %j", (p) => {
    expect(resolveAdminUpstream(API, p)).toBeNull();
  });

  it("protocol-relative input cannot change the origin (stays under /admin/)", () => {
    expect(resolveAdminUpstream(API, "//evil.example/x")).toBe(`${API}/admin/evil.example/x`);
  });

  it("rejects non-strings", () => {
    for (const p of [undefined, null, 1, {}, ["a"]]) expect(resolveAdminUpstream(API, p)).toBeNull();
  });
});

describe("safeGrafanaSegments", () => {
  it("accepts embed paths and rejects traversal", () => {
    expect(safeGrafanaSegments(["d-solo", "uid", "slug"])).toBe(true);
    expect(safeGrafanaSegments(["api", "health"])).toBe(true);
    for (const segs of [[], [".."], ["d", ".."], ["."], ["a..b"], ["a/b"], [""], ["a\\b"]]) {
      expect(safeGrafanaSegments(segs)).toBe(false);
    }
  });
});

describe.each(MODES)("S-01 /api/admin-proxy — %s", (_name, mode) => {
  beforeEach(() => setMode(mode));

  it("POST without a session → 404, no upstream call, token never forwarded", async () => {
    const res = await adminProxy.POST(postProxy("/executive/summary", ""));
    expect(res.status).toBe(404);
    expectNoUpstream();
  });

  it("POST with the old forgeable cookies → 404, no upstream call", async () => {
    const res = await adminProxy.POST(postProxy("/jobs/trigger/outreach"));
    expect(res.status).toBe(404);
    expectNoUpstream();
  });

  it.each(["../health", "%2e%2e/rpc", "foo/../../credits"])("POST traversal %j → 404", async (p) => {
    const res = await adminProxy.POST(postProxy(p));
    expect(res.status).toBe(404);
    expectNoUpstream();
  });

  it("GET ?stream= (SSE) → 404, no upstream call", async () => {
    const res = await adminProxy.GET(
      new Request("https://satelink.network/api/admin-proxy?stream=live/feed", { headers: { cookie: FORGED_COOKIES } })
    );
    expect(res.status).toBe(404);
    expectNoUpstream();
  });

  it("GET ?stream= traversal → 404", async () => {
    const res = await adminProxy.GET(new Request("https://satelink.network/api/admin-proxy?stream=../health"));
    expect(res.status).toBe(404);
    expectNoUpstream();
  });

  it("response body never contains the token", async () => {
    const res = await adminProxy.POST(postProxy("/config"));
    expect(await res.text()).not.toContain(TOKEN);
  });
});

describe.each(MODES)("S-01 /api/grafana/* — %s", (_name, mode) => {
  beforeEach(() => setMode(mode));
  const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

  it("GET panel → 404, Grafana token never forwarded", async () => {
    const res = await grafana.GET(
      new Request("https://satelink.network/api/grafana/d-solo/uid/slug?panelId=1", { headers: { cookie: FORGED_COOKIES } }),
      ctx(["d-solo", "uid", "slug"])
    );
    expect(res.status).toBe(404);
    expectNoUpstream();
  });

  it("POST (e.g. Grafana API write) → 404", async () => {
    const res = await grafana.POST(
      new Request("https://satelink.network/api/grafana/api/dashboards/db", { method: "POST", body: "{}" }),
      ctx(["api", "dashboards", "db"])
    );
    expect(res.status).toBe(404);
    expectNoUpstream();
  });

  it("traversal segments → 404", async () => {
    const res = await grafana.GET(new Request("https://satelink.network/api/grafana/x"), ctx(["..", "api", "admin"]));
    expect(res.status).toBe(404);
    expectNoUpstream();
  });
});

describe.each(MODES)("S-02 /api/ops-auth — %s", (_name, mode) => {
  beforeEach(() => setMode(mode));

  it("even the CORRECT token → 404 and no ops-session cookie is set", async () => {
    const res = await opsAuth.POST(
      new Request("https://satelink.network/api/ops-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN }),
      })
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

// The web vitest config leaves JSX unparsed (tsconfig jsx: preserve), so the
// layout is checked at source level; its runtime 404 is proven by the
// middleware tests below, which run first for every /ops request.
describe("S-02 /ops layout (source)", () => {
  const src = readFileSync(resolve(__dirname, "..", "src", "app", "ops", "layout.tsx"), "utf8")
    .replace(/\/\/.*$/gm, "");

  it("no longer reads cookies or trusts ops-session / x-admin-token", () => {
    expect(src).not.toMatch(/cookies\(/);
    expect(src).not.toMatch(/ops-session|x-admin-token/);
  });

  it("404s via notFound() unless the admin UI gate passes", () => {
    expect(src).toMatch(/if \(!adminUiAllowed\(\)\) notFound\(\);/);
  });
});

describe.each(MODES)("S-02 middleware: /ops, /admin and admin./ops. hosts — %s", (_name, mode) => {
  beforeEach(() => setMode(mode));

  function run(url: string, cookie = FORGED_COOKIES) {
    const u = new URL(url);
    return middleware(new NextRequest(url, { headers: { host: u.host, cookie } }));
  }

  it.each([
    "https://satelink.network/ops",
    "https://satelink.network/ops/login",
    "https://satelink.network/ops/command-center",
    "https://satelink.network/admin",
    "https://satelink.network/admin/command-center",
    "https://satelink.network/admin/revenue/events",
    "https://ops.satelink.network/",
    "https://ops.satelink.network/command-center",
    "https://admin.satelink.network/",
    "https://admin.satelink.network/admin/command-center",
  ])("%s → 404 even with ops-session/x-admin-token cookies", (url) => {
    expect(run(url).status).toBe(404);
  });

  it("public routes are unaffected", () => {
    expect(run("https://satelink.network/pricing", "").status).toBe(200);
    expect(run("https://satelink.network/administrator", "").status).not.toBe(404);
    expect(run("https://satelink.network/platform/pricing", "").status).toBe(308);
    expect(run("https://machine.satelink.network/", "").status).toBe(200);
  });
});
