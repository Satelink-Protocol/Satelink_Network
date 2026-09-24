// Hex gate (§5.4) — the reposition surface must not hardcode hex colors in
// .tsx outside a small allowlist. Scoped to the files this reposition owns
// (the Satelink Signal system + the (marketing)/(checkout) pages); the
// untouched admin/OS/console dashboards use the separate @satelink/ui system
// and are out of scope (see docs/web/DECISIONS.md). Comments are stripped
// first so PR refs like "#398" don't false-positive.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "src");
// Satelink Signal components were extracted to @satelink/web-ui
// (packages/web-ui) in Phase 2; keep them in the hex gate's scope.
const WEBUI = resolve(__dirname, "..", "..", "..", "packages", "web-ui", "src", "components");
const SCOPED = [
  join(WEBUI, "ui"),
  join(WEBUI, "site"),
  join(ROOT, "app", "(marketing)"),
  join(ROOT, "app", "(checkout)"),
];
const ALLOWLIST = ["terminalwindow", "chart", "palette", "og", "opengraph", "icon"];

function walkTsx(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTsx(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("hex gate (§5.4)", () => {
  const files = SCOPED.flatMap((d) => walkTsx(d));

  it("scans a non-trivial set of reposition files", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it("has no hardcoded hex in .tsx outside the allowlist", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const base = f.toLowerCase();
      if (ALLOWLIST.some((a) => base.includes(a))) continue;
      const body = stripComments(readFileSync(f, "utf8"));
      const matches = body.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (matches) offenders.push(`${f}: ${[...new Set(matches)].join(", ")}`);
    }
    expect(offenders, `hardcoded hex found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
