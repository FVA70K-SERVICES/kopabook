-- Bot targets/goals for business copilot

CREATE TABLE IF NOT EXISTS bot_targets (
  id TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'sales',
  target_value REAL NOT NULL,
  period TEXT NOT NULL DEFAULT 'today',
  description TEXT,
  created_by TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bot_targets_biz ON bot_targets(business_id, status);
