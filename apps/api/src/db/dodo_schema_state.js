// Shared, in-process readiness flag for the Dodo-rail schema (PR #386).
//
// The boot-time DDL (ensureDodoRailSchema) is best-effort: if it fails, the
// server MUST keep booting so RPC and x402 stay up. But the Dodo webhook must
// then FAIL CLOSED (503) rather than write against a half-migrated schema.
//
// Default is `true` so that:
//   - unit tests (which never run the boot DDL) exercise the normal 200/409 paths;
//   - the flag flips to `false` ONLY when the boot DDL actually fails.
// On a successful boot DDL it is set to `true` explicitly.
let ready = true;

/** @param {boolean} v */
export function setDodoSchemaReady(v) {
  ready = !!v;
}

/** @returns {boolean} */
export function isDodoSchemaReady() {
  return ready;
}
