// Loads first (sorted glob, sequential ESM import): requiring the guard here
// runs it even when mocha is invoked without `--require` (e.g. a bare
// `npx mocha --no-config 'test/**/*.test.js'`), before any other test file is
// imported. Also unit-tests the guard's host check.
import { createRequire } from 'node:module';
import { expect } from 'chai';

const require = createRequire(import.meta.url);
const { check, hostOf } = require('./_guard/prod_db_guard.cjs');

describe('prod DB guard', () => {
  it('allows local TCP hosts and unix sockets', () => {
    expect(check({ DATABASE_URL: 'postgresql://u:p@localhost:5432/satelink_test' })).to.deep.equal([]);
    expect(check({ DATABASE_URL: 'postgresql://ci:ci@127.0.0.1:54329/ci_test' })).to.deep.equal([]);
    expect(check({ DATABASE_URL: 'postgres:///satelink_test?host=/tmp' })).to.deep.equal([]);
    expect(check({})).to.deep.equal([]);
  });

  it('refuses a Railway proxy host and never echoes credentials', () => {
    const problems = check({ DATABASE_URL: 'postgresql://postgres:s3cret@roundhouse.proxy.rlwy.net:12345/railway' });
    expect(problems).to.have.length(1);
    expect(problems[0]).to.contain('roundhouse.proxy.rlwy.net');
    expect(problems[0]).to.not.contain('s3cret');
  });

  it('refuses any non-allow-listed host (allowlist, not denylist)', () => {
    expect(check({ TEST_DATABASE_URL: 'postgres://u@db.example.com/x' })).to.have.length(1);
    expect(check({ DATABASE_PUBLIC_URL: 'postgres://u@postgres.railway.internal/x' })).to.have.length(1);
    expect(check({ PGHOST: 'roundhouse.proxy.rlwy.net' })).to.have.length(1);
  });

  it('honours TEST_DB_ALLOWED_HOSTS for a dedicated remote test DB', () => {
    expect(check({ DATABASE_URL: 'postgres://u@testdb/x', TEST_DB_ALLOWED_HOSTS: 'testdb' })).to.deep.equal([]);
  });

  it('flags an unparseable URL instead of passing it', () => {
    expect(check({ DATABASE_URL: 'not a url' })).to.have.length(1);
    expect(hostOf('not a url')).to.have.property('error');
  });
});
