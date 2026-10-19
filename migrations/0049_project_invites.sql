-- KopaBook project invites (migration 0049)
-- One account, one login. A project owner invites people by email or username.
-- Invited members join with their existing KopaBook account and see ONLY the
-- invited project, never the rest of the business.
-- Run one statement at a time in the D1 console. If an ALTER fails with
-- "duplicate column name", that column already exists: skip to the next statement.

CREATE TABLE IF NOT EXISTS project_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'contributor' CHECK (role IN ('contributor', 'viewer')),
  invited_email TEXT,
  invited_username TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'contributor' CHECK (role IN ('contributor', 'viewer')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pinv_token ON project_invites(token);

CREATE INDEX IF NOT EXISTS idx_pinv_project ON project_invites(project_id, status);

CREATE INDEX IF NOT EXISTS idx_pmem_user ON project_members(user_id);

CREATE INDEX IF NOT EXISTS idx_pmem_project ON project_members(project_id);

ALTER TABLE users ADD COLUMN username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
