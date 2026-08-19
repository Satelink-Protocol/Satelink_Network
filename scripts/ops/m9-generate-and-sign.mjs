#!/usr/bin/env node
/**
 * m9-generate-and-sign.mjs — fresh M9 signer wallet, key held only in the
 * macOS Keychain.
 *
 * Purpose: eliminate manual private-key copy/paste from the M9 exit-gate
 * workflow. The private key is generated in-process and handed straight to the
 * login Keychain; it is NEVER printed, NEVER written to any file, and NEVER
 * placed on a shell command line (all `security` calls use execFile with an
 * argv array — no shell, no history). Only the public address is emitted.
 *
 * Modes:
 *   generate (default) — generate a keypair, store the private key in the
 *                        Keychain, print ONLY the public address.
 *   sign               — deferred. Fund the address first, then a later step
 *                        retrieves the key from the Keychain (never to disk)
 *                        and signs the schedule. Intentionally inert here.
 *
 * Keychain item (login keychain, generic password):
 *   service = satelink-m9-signer   account = m9-schedule-signer
 * The Apple `security` tool is added to the item's ACL (-T /usr/bin/security)
 * so the later sign step can read the key back non-interactively.
 *
 * Usage:
 *   node scripts/ops/m9-generate-and-sign.mjs            # generate + store + print address
 *   node scripts/ops/m9-generate-and-sign.mjs generate   # (same)
 */

import { execFileSync } from 'node:child_process';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const KEYCHAIN_SERVICE = 'satelink-m9-signer';
const KEYCHAIN_ACCOUNT = 'm9-schedule-signer';
const SECURITY_BIN = '/usr/bin/security';

/** True if a Keychain item already exists under our service/account. Reads only
 * attributes (no `-w`), so it never surfaces the secret and never prompts. */
function keychainEntryExists() {
  try {
    execFileSync(SECURITY_BIN, ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/** Store the private key in the login Keychain. The key is passed only as an
 * argv element to `security` via execFile (no shell) — never logged, never
 * written to a file. Throws if `security` returns non-zero. */
function storeKeyInKeychain(privateKey) {
  execFileSync(
    SECURITY_BIN,
    [
      'add-generic-password',
      '-s', KEYCHAIN_SERVICE,
      '-a', KEYCHAIN_ACCOUNT,
      '-D', 'satelink m9 signer private key',
      '-T', SECURITY_BIN, // allow the security tool to read it back (non-interactive sign step)
      '-w', privateKey,
    ],
    { stdio: 'ignore' },
  );
}

function generate() {
  // Refuse to clobber an existing signer — its address may already be funded.
  if (keychainEntryExists()) {
    console.error(
      `Refusing to overwrite an existing key in the Keychain ` +
        `(service="${KEYCHAIN_SERVICE}", account="${KEYCHAIN_ACCOUNT}").`,
    );
    console.error('If you truly want a new wallet (any funds on the old address will be orphaned), remove it first:');
    console.error(`  security delete-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT}`);
    process.exit(1);
  }

  // Key exists only in memory from here; it is never printed or persisted to a file.
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  storeKeyInKeychain(privateKey); // throws if the add failed

  // Confirm the item is present without ever reading the secret back.
  if (!keychainEntryExists()) {
    console.error('ERROR: key was generated but its Keychain item could not be verified. Aborting.');
    process.exit(1);
  }

  console.log('=== M9 signer wallet generated ===');
  console.log(`Address (public — safe to share / fund):  ${account.address}`);
  console.log('');
  console.log('Private key: stored in the macOS login Keychain, NOT printed and NOT written to any file.');
  console.log(`  Keychain item -> service="${KEYCHAIN_SERVICE}"  account="${KEYCHAIN_ACCOUNT}"`);
  console.log('');
  console.log('Next: fund the address above, then confirm before the (deferred) signing step.');
}

const mode = process.argv[2] ?? 'generate';
if (mode === 'generate') {
  generate();
} else if (mode === 'sign') {
  console.error('sign mode is intentionally deferred. Fund the address first, then confirm to enable signing.');
  process.exit(2);
} else {
  console.error(`Unknown mode "${mode}". Use: generate`);
  process.exit(2);
}
