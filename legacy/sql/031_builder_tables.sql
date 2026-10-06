CREATE TABLE IF NOT EXISTS builders (
    wallet TEXT PRIMARY KEY,
    created_at INTEGER
);
CREATE TABLE IF NOT EXISTS builder_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    builder_wallet TEXT,
    name TEXT,
    status TEXT DEFAULT 'active',
    created_at INTEGER
);
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    key_hash TEXT,
    key_prefix TEXT,
    status TEXT DEFAULT 'active',
    created_at INTEGER,
    revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    ts INTEGER,
    endpoint TEXT,
    ok INTEGER,
    cost_usdt REAL,
    meta_json TEXT
);
