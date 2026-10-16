-- KopaBook Developer API keys (migration 0037)
-- Owners/partners create keys; developers use them as
--   Authorization: Bearer kbk_live_...
-- Only the sha256 hash is stored. The raw key is shown once at creation.

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL DEFAULT '',
  scopes TEXT NOT NULL DEFAULT 'read',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_business ON api_keys(business_id, status);

-- Lightweight per-key rate limiting (60 requests/minute per key)
CREATE TABLE IF NOT EXISTS api_key_hits (
  key_id INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, window_start)
);
