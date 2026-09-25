// TI_KEY_LOGGING one-off: redact full API keys stored outside the identifier
// columns. DRY RUN by default (counts only); --apply performs the UPDATEs in one
// transaction. Idempotent: a second run finds nothing to change.
//   railway run --service Satelink-api -- node scripts/incidents/redact_exposed_keys.mjs [--apply]
// Never prints a key — only counts and fingerprints (sk_xxx_…abcd).
// Deliberately NOT changed: principals.external_ref (Financial OS identity link
// to api_credits) — see docs/incidents/TI_KEY_LOGGING.md, recommendation 3.
import pg from 'pg';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (!url) throw new Error('DATABASE_URL not set');
const pool = new pg.Pool({ connectionString: url });

// hint = prefix + '…' + last 4 (same as src/security/key_mask.mjs keyHint)
const HINT_RE = `(sk_[a-z]+_)[0-9a-f]{36,}([0-9a-f]{4})`;
const STEPS = [
  {
    name: 'revenue_events_v2.request_id (Trading Intelligence ids carrying the key)',
    count: `SELECT count(*)::int n FROM revenue_events_v2 WHERE op_type = 'intelligence' AND position(client_id in request_id) > 0`,
    update: `UPDATE revenue_events_v2
                SET request_id = replace(request_id, client_id, 'kref_' || left(encode(sha256(client_id::bytea), 'hex'), 16))
              WHERE op_type = 'intelligence' AND position(client_id in request_id) > 0`,
  },
  {
    name: 'machine_crm_snapshots.machines (hourly CRM snapshots)',
    count: `SELECT count(*)::int n FROM machine_crm_snapshots WHERE machines::text ~ 'sk_[a-z]+_[0-9a-f]{40,}'`,
    update: `UPDATE machine_crm_snapshots
                SET machines = regexp_replace(machines::text, '${HINT_RE}', '\\1…\\2', 'g')::jsonb
              WHERE machines::text ~ 'sk_[a-z]+_[0-9a-f]{40,}'`,
  },
];

const client = await pool.connect();
try {
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  for (const s of STEPS) {
    const before = (await client.query(s.count)).rows[0].n;
    let changed = 0;
    if (apply && before > 0) changed = (await client.query(s.update)).rowCount;
    console.log(JSON.stringify({ step: s.name, rows_with_keys: before, redacted: apply ? changed : 'dry-run' }));
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  if (apply) {
    for (const s of STEPS) console.log(JSON.stringify({ step: s.name, remaining: (await client.query(s.count)).rows[0].n }));
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
