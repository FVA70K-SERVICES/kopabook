-- 0056: Per-account 4-digit PIN app lock.
-- The PIN itself is never stored: pin_hash holds a salted PBKDF2 hash in
-- the same format as account passwords. failed_attempts and
-- lockout_episodes drive escalating lockouts (5 wrong attempts, then
-- 1 minute, 5 minutes, then 15 minutes). The invite fields implement the
-- dashboard invitation: 3-day snooze per dismissal, stop after 3.
-- sign_in_count is maintained by the sign-in flows so brand-new accounts
-- are not invited during their first session; accounts that already
-- exist when this migration lands start at 2 (they have signed in before).

CREATE TABLE IF NOT EXISTS user_app_locks (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  pin_hash TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  lockout_episodes INTEGER NOT NULL DEFAULT 0,
  lockout_until TEXT,
  invite_dismissal_count INTEGER NOT NULL DEFAULT 0,
  invite_snoozed_until TEXT,
  sign_in_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- (INSERT OR IGNORE, not an upsert: "FROM users ON CONFLICT" parses as
-- a join condition in SQLite and the statement fails.)
INSERT OR IGNORE INTO user_app_locks (user_id, sign_in_count)
SELECT id, 2 FROM users;

CREATE INDEX IF NOT EXISTS idx_user_app_locks_lockout
  ON user_app_locks(lockout_until);
