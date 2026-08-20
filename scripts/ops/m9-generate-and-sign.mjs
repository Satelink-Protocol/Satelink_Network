#!/usr/bin/env node
/**
 * m9-generate-and-sign.mjs — fresh M9 signer wallet, key held only in the
 * macOS Keychain.
 *
 * Purpose: eliminate manual private-key copy/paste from the M9 exit-gate
 * workflow. The private key is generated in-process and handed to the login
 * Keychain WITHOUT ever appearing in a process argument list or a file:
 *
 *   - Writing to the Keychain: `security add-generic-password -w` reads its
 *     password from the tty prompt (readpassphrase), NOT from stdin. So the key
 *     is typed into that prompt over a pty whose slave is the child's
 *     CONTROLLING terminal (Python `pty.fork`). The key travels
 *     node -> python(stdin) -> pty -> security. It is never a command-line
 *     argument (so never visible via `ps`), never written to a file, never
 *     printed. Only the public address is emitted.
 *   - Reading it back (verify / later sign step) uses `security
 *     find-generic-password -w`, whose secret comes out on stdout and is
 *     captured in-process — again never on a command line.
 *
 * Requires python3 (ships with the macOS Command Line Tools) for the pty write.
 *
 * Modes:
 *   generate (default) — generate a keypair, store the key, round-trip verify,
 *                        print ONLY the public address.
 *   reseal             — re-store the EXISTING key through the same pty path
 *                        (e.g. to re-secure a key previously stored via argv)
 *                        and round-trip verify. Prints the address; never the key.
 *   sign               — deferred. Fund the address first; a later step reads
 *                        the key from the Keychain (never to disk) and signs.
 *
 * Keychain item (login keychain, generic password):
 *   service = satelink-m9-signer   account = m9-schedule-signer
 * The creating app (`security`) is trusted to read the item back by default, so
 * the sign step reads it non-interactively.
 *
 * Usage:
 *   node scripts/ops/m9-generate-and-sign.mjs            # generate + store + verify + print address
 *   node scripts/ops/m9-generate-and-sign.mjs reseal     # re-secure existing key + verify
 */

import { execFileSync } from 'node:child_process';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const KEYCHAIN_SERVICE = 'satelink-m9-signer';
const KEYCHAIN_ACCOUNT = 'm9-schedule-signer';
const SECURITY_BIN = '/usr/bin/security';

/**
 * Python helper (run via `python3 -c`). Reads the secret from stdin and types it
 * into `security add-generic-password -w`'s tty prompt over a pty.fork()
 * controlling terminal, so the secret is never in an argv or a file. The two
 * writes cover the password + retype prompts. argv: <service> <account>.
 * Contains no backticks or ${...}, so it is safe inside this template literal.
 */
const PY_KEYCHAIN_STORE = `
import os, sys, pty, time, select
service, account = sys.argv[1], sys.argv[2]
secret = sys.stdin.buffer.read().decode().strip()
pid, fd = pty.fork()
if pid == 0:
    os.execv("/usr/bin/security",
             ["security", "add-generic-password", "-s", service, "-a", account,
              "-U", "-D", "satelink m9 signer private key", "-w"])
    os._exit(127)
sent = 0; buf = b""; deadline = time.time() + 8; code = None
while time.time() < deadline:
    try:
        wpid, status = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            code = os.waitstatus_to_exitcode(status); break
    except ChildProcessError:
        break
    try:
        r, _, _ = select.select([fd], [], [], 0.3)
    except OSError:
        break
    if fd not in r:
        continue
    try:
        data = os.read(fd, 1024)
    except OSError:
        break
    if not data:
        continue
    buf += data
    low = buf.lower().rstrip()
    if sent < 2 and b"password" in low and low.endswith(b":"):
        os.write(fd, (secret + "\\n").encode()); sent += 1; buf = b""
if code is None:
    try:
        _, status = os.waitpid(pid, 0); code = os.waitstatus_to_exitcode(status)
    except ChildProcessError:
        code = 0
sys.exit(code or 0)
`;

/** True if a Keychain item exists under our service/account. Reads only
 * attributes (no -w), so it never surfaces the secret and never prompts. */
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

/** Store the private key via the pty path. The key is fed on stdin (never argv,
 * never a file). Throws if python3 is missing or `security` returns non-zero. */
function storeKeyInKeychain(privateKey) {
  try {
    execFileSync('python3', ['-c', PY_KEYCHAIN_STORE, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT], {
      input: privateKey,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 15000,
    });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error('python3 not found — install the macOS Command Line Tools (xcode-select --install).');
    }
    throw err;
  }
}

/** Read the key back from the Keychain into memory (never printed). The secret
 * exits `security` on stdout and is captured here; no secret on any argv. */
function readKeyFromKeychain() {
  return execFileSync(SECURITY_BIN, ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'], {
    encoding: 'utf8',
    timeout: 8000,
  }).replace(/\r?\n$/, '');
}

/** Store then read back and confirm the stored key derives `expectedAddress`.
 * The key is never printed. Throws on mismatch. */
function roundTripVerify(privateKey, expectedAddress) {
  storeKeyInKeychain(privateKey);
  const back = readKeyFromKeychain();
  const derived = privateKeyToAccount(back).address;
  if (derived.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('round-trip verification FAILED: stored key does not derive the expected address.');
  }
}

function generate() {
  if (keychainEntryExists()) {
    console.error(
      `Refusing to overwrite an existing key in the Keychain ` +
        `(service="${KEYCHAIN_SERVICE}", account="${KEYCHAIN_ACCOUNT}").`,
    );
    console.error('To re-secure the existing key through the pty path, use:  reseal');
    console.error('For a genuinely NEW wallet (old address would be orphaned), remove it first:');
    console.error(`  security delete-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT}`);
    process.exit(1);
  }

  const privateKey = generatePrivateKey(); // in memory only; never printed or written to a file
  const address = privateKeyToAccount(privateKey).address;

  roundTripVerify(privateKey, address); // stores via the pty path, then confirms

  console.log('=== M9 signer wallet generated ===');
  console.log(`Address (public — safe to share / fund):  ${address}`);
  console.log('');
  console.log('Private key: stored in the macOS login Keychain via a pty (never on a command');
  console.log('line, never written to a file, never printed). Round-trip verified.');
  console.log(`  Keychain item -> service="${KEYCHAIN_SERVICE}"  account="${KEYCHAIN_ACCOUNT}"`);
  console.log('');
  console.log('Next: fund the address above, then confirm before the (deferred) signing step.');
}

function reseal() {
  if (!keychainEntryExists()) {
    console.error(`No key found to reseal (service="${KEYCHAIN_SERVICE}", account="${KEYCHAIN_ACCOUNT}"). Use: generate`);
    process.exit(1);
  }
  const before = readKeyFromKeychain();
  const address = privateKeyToAccount(before).address; // confirms we hold a valid key before re-storing

  roundTripVerify(before, address); // re-store via the pty path (-U), then confirm it still derives `address`

  console.log('=== M9 signer key re-sealed via pty path ===');
  console.log(`Address (unchanged):  ${address}`);
  console.log('The key was re-stored through the pty (no argv exposure) and round-trip verified.');
}

const mode = process.argv[2] ?? 'generate';
if (mode === 'generate') {
  generate();
} else if (mode === 'reseal') {
  reseal();
} else if (mode === 'sign') {
  console.error('sign mode is intentionally deferred. Fund the address first, then confirm to enable signing.');
  process.exit(2);
} else {
  console.error(`Unknown mode "${mode}". Use: generate | reseal`);
  process.exit(2);
}
