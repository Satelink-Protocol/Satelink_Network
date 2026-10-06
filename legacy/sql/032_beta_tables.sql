CREATE TABLE IF NOT EXISTS beta_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_code TEXT UNIQUE,
    created_by_wallet TEXT,
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    expires_at INTEGER,
    status TEXT DEFAULT 'active',
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS beta_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT UNIQUE,
    invite_code TEXT,
    status TEXT DEFAULT 'active',
    first_seen_at INTEGER,
    last_seen_at INTEGER,
    notes TEXT,
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS beta_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT,
    category TEXT,
    severity TEXT,
    message TEXT,
    page_url TEXT,
    trace_id TEXT,
    created_at INTEGER,
    status TEXT DEFAULT 'open',
    triaged_by TEXT,
    resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_beta_invites_code ON beta_invites(invite_code);
CREATE INDEX IF NOT EXISTS idx_beta_users_wallet ON beta_users(wallet);
CREATE INDEX IF NOT EXISTS idx_beta_feedback_wallet ON beta_feedback(wallet);

INSERT OR IGNORE INTO system_flags (key, value, updated_at) VALUES ('beta_gate_enabled', '0', 0);
INSERT OR IGNORE INTO system_flags (key, value, updated_at) VALUES ('rewards_simulation', '1', 0);
