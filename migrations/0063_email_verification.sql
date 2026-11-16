-- Migration 0063 — email verification plumbing (Fix 2.6).
-- Applied one statement at a time via the D1 API before the code push,
-- same as migration 0062. No d1_migrations tracking table exists in this
-- database; this file is the record.
--
-- Statement 1: verified flag on the user row (NULL until verified).
-- Sign-in never requires it; it only records the proof.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;

-- Statement 2: single-use verification tokens (raw token never stored,
-- only its SHA-256 hash — same pattern as password_resets).
CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Statement 3: token lookup by hash.
CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token_hash);

-- Statement 4: per-user token listing (invalidate older tokens on verify).
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
