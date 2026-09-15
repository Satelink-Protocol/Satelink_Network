// T-04 (2026-09-15): the @x402/* packages must resolve to ONE version.
//
// Production outage 2026-08-20 → 2026-09-15: every anonymous 402 lost its
// x402 `accepts` with "Cannot read properties of undefined (reading
// 'undefined')". Railway builds apps/api in isolation WITHOUT the workspace
// lockfile, so PR #332's exact pin on @x402/evm (2.18.0) sat next to caret
// ranges that resolved @x402/core / express / extensions to 2.25.0. core 2.25's
// x402HTTPResourceServer constructor reads schemeServer.paymentFlows[...],
// which an evm-2.18 ExactEvmScheme does not have.
//
// t2/t9 in x402_rail.test.js could not see this: the lockfile install keeps all
// four at 2.18.0, and they need live CDP credentials. These checks are offline
// and fail for the real cause.

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { x402ResourceServer, x402HTTPResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['@x402/core', '@x402/evm', '@x402/express', '@x402/extensions'];

function installedVersion(pkg) {
  const require = createRequire(join(API_DIR, 'package.json'));
  let dir = dirname(require.resolve(pkg));
  while (!dir.endsWith(pkg.split('/')[1])) dir = dirname(dir);
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
}

describe('T-04 @x402/* dependency skew guard', () => {
  it('apps/api/package.json pins every @x402/* package to the same exact version', () => {
    const deps = JSON.parse(readFileSync(join(API_DIR, 'package.json'), 'utf8')).dependencies;
    const specs = PACKAGES.map((p) => deps[p]);
    for (const [i, spec] of specs.entries()) {
      expect(spec, `${PACKAGES[i]} must be an exact version (lockfile-free Railway build)`).to.match(/^\d+\.\d+\.\d+$/);
    }
    expect(new Set(specs).size, `specs differ: ${specs.join(', ')}`).to.equal(1);
  });

  it('the installed @x402/* packages resolve to one version', () => {
    const versions = PACKAGES.map(installedVersion);
    expect(new Set(versions).size, `installed: ${PACKAGES.map((p, i) => `${p}@${versions[i]}`).join(', ')}`).to.equal(1);
  });

  it('x402HTTPResourceServer accepts an ExactEvmScheme route (offline, no facilitator call)', () => {
    const client = new HTTPFacilitatorClient({ url: 'https://facilitator.invalid' });
    const resourceServer = new x402ResourceServer(client).register('eip155:8453', new ExactEvmScheme());
    const accepts = {
      scheme: 'exact',
      price: '$0.10',
      network: 'eip155:8453',
      payTo: '0x966E1Ae22996545015b1414B35234b10719d7Ad4',
      maxTimeoutSeconds: 60,
    };
    expect(() => new x402HTTPResourceServer(resourceServer, { 'POST /rpc/*': { accepts } })).to.not.throw();
  });
});
